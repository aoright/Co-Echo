/**
 * SoundEngine.js
 * 
 * Co-Echo 音频引擎中央路由与状态管理器。
 * 串级整合声音合成器、空间音频三维声相、反馈延时网络效果器等算法组件，
 * 提供一整套声学物理模拟与时钟事件调度架构。
 */

import { AudioSynthesizer } from '../algorithms/AudioSynthesizer.js';
import { SpatialAudio } from '../algorithms/SpatialAudio.js';
import { SpaceDelay } from '../algorithms/SpaceDelay.js';

export class SoundEngine {
  constructor() {
    this.audioCtx = null;
    this.analyser = null;
    this.isPlaying = false;
    
    this.bpm = 90;
    this.currentScale = 'major-pentatonic';
    
    // 各声轨节点挂载
    this.nodes = {
      beat: { gain: null, panner: null },
      melody: { gain: null, panner: null },
      voice: { gain: null, panner: null },
      ambient: { gain: null, panner: null },
      bass: { gain: null }
    };
    
    this.effects = {
      melodyDelay: null,
      melodyFeedback: null,
      voiceDelay: null,
      voiceFeedback: null
    };

    this.recordingDest = null;
    
    // 调度时钟参数
    this.schedulerTimer = null;
    this.nextStepTime = 0.0;
    this.currentStep = 0;
    this.lookahead = 25.0; // ms
    this.scheduleAheadTime = 0.1; // s
    
    this.scales = {
      'major-pentatonic': [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25],
      'minor-pentatonic': [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33],
      'lydian': [261.63, 293.66, 329.63, 369.99, 392.00, 440.00, 493.88, 523.25],
      'dorian': [293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25, 587.33]
    };

    this.noiseBuffer = null;
  }

  /**
   * 初始化引擎，激活 AudioContext
   */
  init() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContext();
    
    // 显式激活 AudioContext 状态，确保在 macOS/iOS 等严格安全沙箱中能正常播放声音
    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 64;
    this.analyser.connect(this.audioCtx.destination);

    // 创建混音捕获目的节点
    this.recordingDest = this.audioCtx.createMediaStreamDestination();
    this.analyser.connect(this.recordingDest);

    this.noiseBuffer = this.createNoiseBuffer();

    this.initTracks();
    this.isPlaying = true;
    
    this.nextStepTime = this.audioCtx.currentTime;
    this.scheduler();

    this.startContinuousSounds();
  }

  /**
   * 释放音频上下文
   */
  close() {
    if (this.audioCtx) {
      clearTimeout(this.schedulerTimer);
      this.stopContinuousSounds();
      this.audioCtx.close();
      this.audioCtx = null;
      this.isPlaying = false;
    }
  }

  createNoiseBuffer() {
    const bufferSize = 2 * this.audioCtx.sampleRate;
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  /**
   * 初始化音轨通道并串联效果器
   */
  initTracks() {
    const ctx = this.audioCtx;

    // 1. Beat
    this.nodes.beat.panner = ctx.createPanner();
    this.nodes.beat.gain = ctx.createGain();
    this.nodes.beat.gain.gain.value = 0.0;
    SpatialAudio.updatePannerPosition(this.nodes.beat.panner, 0, 0, ctx);
    this.nodes.beat.panner.connect(this.nodes.beat.gain);
    this.nodes.beat.gain.connect(this.analyser);

    // 2. Melody + Space Delay (延时效果器级联)
    this.nodes.melody.panner = ctx.createPanner();
    this.nodes.melody.gain = ctx.createGain();
    this.nodes.melody.gain.gain.value = 0.0;
    SpatialAudio.updatePannerPosition(this.nodes.melody.panner, 0, 0, ctx);
    
    const melDelayBundle = SpaceDelay.createDelayFeedbackLoop(
      ctx, 
      this.nodes.melody.panner, 
      this.nodes.melody.gain, 
      0.35, 
      0.4
    );
    this.effects.melodyDelay = melDelayBundle.delayNode;
    this.effects.melodyFeedback = melDelayBundle.feedbackNode;
    this.nodes.melody.gain.connect(this.analyser);

    // 3. Voice + Space Delay
    this.nodes.voice.panner = ctx.createPanner();
    this.nodes.voice.gain = ctx.createGain();
    this.nodes.voice.gain.gain.value = 0.0;
    SpatialAudio.updatePannerPosition(this.nodes.voice.panner, 0, 0, ctx);

    const voiceDelayBundle = SpaceDelay.createDelayFeedbackLoop(
      ctx,
      this.nodes.voice.panner,
      this.nodes.voice.gain,
      0.5,
      0.3
    );
    this.effects.voiceDelay = voiceDelayBundle.delayNode;
    this.effects.voiceFeedback = voiceDelayBundle.feedbackNode;
    this.nodes.voice.gain.connect(this.analyser);

    // 4. Ambient
    this.nodes.ambient.panner = ctx.createPanner();
    this.nodes.ambient.gain = ctx.createGain();
    this.nodes.ambient.gain.gain.value = 0.0;
    SpatialAudio.updatePannerPosition(this.nodes.ambient.panner, 0, 0, ctx);
    this.nodes.ambient.panner.connect(this.nodes.ambient.gain);
    this.nodes.ambient.gain.connect(this.analyser);

    // 5. AI Bass
    this.nodes.bass.gain = ctx.createGain();
    this.nodes.bass.gain.gain.value = 0.0;
    this.nodes.bass.gain.connect(this.analyser);
  }

  /**
   * 外部更新各个声像参数入口
   */
  updateTrackSpatial(trackName, normX, normY, gain) {
    if (!this.isPlaying || !this.audioCtx) return;
    SpatialAudio.updatePannerPosition(this.nodes[trackName].panner, normX, normY, this.audioCtx);
    this.nodes[trackName].gain.gain.setTargetAtTime(gain, this.audioCtx.currentTime, 0.1);
  }

  /**
   * 启动环境和背景音源
   */
  startContinuousSounds() {
    const ctx = this.audioCtx;

    // 1. 纯音乐合成：不涉及人声连续发声。和弦背景声部将由时钟管理器按节拍动态合成触发。

    // 2. 环境氛围（白噪声）
    this.ambientSource = ctx.createBufferSource();
    this.ambientSource.buffer = this.noiseBuffer;
    this.ambientSource.loop = true;

    this.ambientFilter = ctx.createBiquadFilter();
    this.ambientFilter.type = 'lowpass';
    this.ambientFilter.frequency.value = 400;
    this.ambientFilter.Q.value = 1.0;

    this.ambientLfo = ctx.createOscillator();
    this.ambientLfo.frequency.value = 0.15; // 0.15Hz 呼吸起伏
    this.ambientLfoGain = ctx.createGain();
    this.ambientLfoGain.gain.value = 250;

    this.ambientLfo.connect(this.ambientLfoGain);
    this.ambientLfoGain.connect(this.ambientFilter.frequency);
    
    this.ambientSource.connect(this.ambientFilter);
    this.ambientFilter.connect(this.nodes.ambient.panner);

    this.ambientLfo.start();
    this.ambientSource.start();

    // 3. AI Bassline
    this.bassOsc = ctx.createOscillator();
    this.bassOsc.type = 'sine';
    this.bassOsc.frequency.value = 55;
    this.bassOsc.connect(this.nodes.bass.gain);
    this.bassOsc.start();
  }

  stopContinuousSounds() {
    try {
      if (this.ambientSource) this.ambientSource.stop();
      if (this.ambientLfo) this.ambientLfo.stop();
      if (this.bassOsc) this.bassOsc.stop();
    } catch (e) {
      console.warn("停止持续声源时出错: ", e);
    }
  }

  /**
   * 高精准度时钟分配器
   */
  scheduler() {
    while (this.nextStepTime < this.audioCtx.currentTime + this.scheduleAheadTime) {
      this.scheduleStep(this.currentStep, this.nextStepTime);
      this.nextStep();
    }
    this.schedulerTimer = setTimeout(() => this.scheduler(), this.lookahead);
  }

  nextStep() {
    const secondsPerBeat = 60.0 / this.bpm;
    const stepDuration = secondsPerBeat / 4;
    this.nextStepTime += stepDuration;
    this.currentStep = (this.currentStep + 1) % 16;
  }

  scheduleStep(step, time) {
    // A. 节奏合成触发 (H 元素)
    if (this.nodes.beat.gain.gain.value > 0.01) {
      if (step === 0 || step === 4 || step === 8 || step === 12) {
        AudioSynthesizer.synthKick(this.audioCtx, this.nodes.beat.panner, time);
      }
      if (step === 2 || step === 6 || step === 10 || step === 14) {
        AudioSynthesizer.synthHiHat(this.audioCtx, this.nodes.beat.panner, this.noiseBuffer, time);
      }
      if (step === 8) {
        AudioSynthesizer.synthSnare(this.audioCtx, this.nodes.beat.panner, this.noiseBuffer, time);
      }
    }

    // B. 旋律合成触发 (O 元素)
    if (this.nodes.melody.gain.gain.value > 0.01) {
      if (step % 2 === 0) {
        const scale = this.scales[this.currentScale];
        const melPattern = [0, 4, 2, 6, 1, 5, 3, 7, 4, 2, 5, 3, 0, 4, 1, 6];
        const noteIndex = melPattern[step];
        const freq = scale[noteIndex];
        AudioSynthesizer.synthPluck(this.audioCtx, this.nodes.melody.panner, freq, time);
      }
    }

    // C. 和弦合成触发 (N 元素 - CHORD)
    if (this.nodes.voice.gain.gain.value > 0.01) {
      if (step === 0) {
        // 每 16 步（或每小节开头）触发一次温和的和弦背景音垫 (Chord Pad)
        this.synthChordPad(time);
      }
    }
  }

  /**
   * 控制 Bassline 音量与根音
   */
  setBassActive(isActive, multiplier = 1.0) {
    if (!this.isPlaying || !this.audioCtx) return;
    
    const targetGain = isActive ? 0.35 * multiplier : 0.0;
    this.nodes.bass.gain.gain.setTargetAtTime(targetGain, this.audioCtx.currentTime, 0.2);
    
    if (isActive) {
      const rootFreq = this.scales[this.currentScale][0] / 4;
      this.bassOsc.frequency.setTargetAtTime(rootFreq, this.audioCtx.currentTime, 0.3);
    }
  }

  /**
   * 控制环境调制（原人声调制）
   */
  setVocalModulation(isActive) {
    if (!this.isPlaying || !this.audioCtx) return;
    
    // N (Chord) 与 C (Ambient) 靠近触发《冥想空间》时，加深背景噪声 LFO 的截止频率扫频深度
    if (isActive) {
      this.ambientLfoGain.gain.setValueAtTime(450, this.audioCtx.currentTime);
    } else {
      this.ambientLfoGain.gain.setValueAtTime(250, this.audioCtx.currentTime);
    }
  }

  /**
   * 动态合成温和、空灵的背景和弦音垫 (Chord Pad)
   */
  synthChordPad(time) {
    const ctx = this.audioCtx;
    const baseFreqs = this.scales[this.currentScale];
    
    // 根据当前音阶提取三个音符构成和谐的大/小三和弦 (根音、三音、五音)，根音降一个八度增强厚度
    const chordNotes = [
      baseFreqs[0] / 2, 
      baseFreqs[2],     
      baseFreqs[4]      
    ];

    chordNotes.forEach(freq => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      // 使用三角波合成，比锯齿波更温和空灵，适合做 Pad 背景铺底
      osc.type = 'triangle';
      osc.frequency.value = freq;

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300, time);
      // 截止频率随时间轻微指数下滑，制造温暖自然的衰减感
      filter.frequency.exponentialRampToValueAtTime(150, time + 2.5);

      gain.gain.setValueAtTime(0.0, time);
      // 0.5秒缓慢淡入，消除起音爆音
      gain.gain.linearRampToValueAtTime(0.2, time + 0.5);
      // 2.6秒缓慢淡出
      gain.gain.exponentialRampToValueAtTime(0.001, time + 2.6);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.nodes.voice.panner);

      osc.start(time);
      osc.stop(time + 2.7);
    });
  }
}
