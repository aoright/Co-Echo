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
    this.currentMeasure = 0;
    this.customAmbientBuffer = null;
    this.activePresets = {
      beat: 'minimal',
      melody: 'ethereal',
      chord: 'heal',
      ambient: 'respiration'
    };
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
    if (this.currentStep === 0) {
      this.currentMeasure = (this.currentMeasure + 1) % 4;
    }
  }

  scheduleStep(step, time) {
    // A. 氢元素节奏合成 (H 元素)
    if (this.nodes.beat.gain.gain.value > 0.01) {
      const beatPreset = this.activePresets.beat;
      if (beatPreset === 'minimal') {
        if (step === 0 || step === 8) {
          AudioSynthesizer.synthKick(this.audioCtx, this.nodes.beat.panner, time);
        }
        if (step === 4 || step === 12) {
          AudioSynthesizer.synthHiHat(this.audioCtx, this.nodes.beat.panner, this.noiseBuffer, time);
        }
      } else if (beatPreset === 'lofi') {
        if (step === 0 || step === 10) {
          AudioSynthesizer.synthKick(this.audioCtx, this.nodes.beat.panner, time);
        }
        if (step === 4 || step === 12) {
          AudioSynthesizer.synthSnare(this.audioCtx, this.nodes.beat.panner, this.noiseBuffer, time);
        }
        if (step % 2 === 0) {
          AudioSynthesizer.synthHiHat(this.audioCtx, this.nodes.beat.panner, this.noiseBuffer, time);
        }
      } else if (beatPreset === 'breakbeat') {
        if (step === 0 || step === 6 || step === 10 || step === 14) {
          AudioSynthesizer.synthKick(this.audioCtx, this.nodes.beat.panner, time);
        }
        if (step === 4 || step === 12) {
          AudioSynthesizer.synthSnare(this.audioCtx, this.nodes.beat.panner, this.noiseBuffer, time);
        }
        if (step % 2 === 0) {
          AudioSynthesizer.synthHiHat(this.audioCtx, this.nodes.beat.panner, this.noiseBuffer, time);
        }
      }
    }

    // B. 氧元素旋律合成 (O 元素)
    if (this.nodes.melody.gain.gain.value > 0.01) {
      const melodyPreset = this.activePresets.melody;
      const scale = this.scales[this.currentScale];
      let freq = null;
      
      if (melodyPreset === 'ethereal') {
        if (step % 2 === 0) {
          const etherealPattern = [0, 2, 4, 7, 9, 7, 4, 2];
          const patternIndex = Math.floor(step / 2) % etherealPattern.length;
          const noteIndex = etherealPattern[patternIndex];
          freq = scale[noteIndex % scale.length];
        }
      } else if (melodyPreset === 'waterflow') {
        const waterflowPattern = [0, 4, 3, 5, 2, 6, 1, 7, 4, 3, 2, 5, 0, 1, 6, 4];
        const noteIndex = waterflowPattern[step % waterflowPattern.length];
        freq = scale[noteIndex % scale.length];
      } else if (melodyPreset === 'starlight') {
        // 每 3 步以较高几率触发高音粒子音
        if (step % 3 === 0 && Math.random() > 0.4) {
          const highNotes = [4, 5, 6, 7];
          const randIndex = highNotes[Math.floor(Math.random() * highNotes.length)];
          freq = scale[randIndex % scale.length] * 2; // 升高一个八度
        }
      }

      if (freq) {
        AudioSynthesizer.synthPluck(this.audioCtx, this.nodes.melody.panner, freq, time);
      }
    }

    // C. 氮元素和弦合成 (N 元素 - CHORD)
    if (this.nodes.voice.gain.gain.value > 0.01) {
      if (step === 0) {
        // 每小节开头触发一次和弦铺底
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
    const N = baseFreqs.length;
    const chordPreset = this.activePresets.chord;
    
    let chordNotes = [];
    if (chordPreset === 'heal') {
      // I - vi - IV - V 级和弦循环
      if (this.currentMeasure === 0) {
        chordNotes = [baseFreqs[0] / 2, baseFreqs[2], baseFreqs[4]];
      } else if (this.currentMeasure === 1) {
        chordNotes = [baseFreqs[4] / 2, baseFreqs[0], baseFreqs[2]];
      } else if (this.currentMeasure === 2) {
        chordNotes = [baseFreqs[3] / 2, baseFreqs[5 % N], baseFreqs[0]];
      } else {
        chordNotes = [baseFreqs[4] / 2, baseFreqs[6 % N], baseFreqs[1]];
      }
    } else if (chordPreset === 'space') {
      // 挂留悬浮和弦循环
      if (this.currentMeasure === 0) {
        chordNotes = [baseFreqs[0] / 2, baseFreqs[1], baseFreqs[4]];
      } else if (this.currentMeasure === 1) {
        chordNotes = [baseFreqs[3] / 2, baseFreqs[4], baseFreqs[0]];
      } else if (this.currentMeasure === 2) {
        chordNotes = [baseFreqs[4] / 2, baseFreqs[5 % N], baseFreqs[1]];
      } else {
        chordNotes = [baseFreqs[4] / 2, baseFreqs[0], baseFreqs[3]];
      }
    } else if (chordPreset === 'deepsea') {
      // 平行四五度神秘和弦
      if (this.currentMeasure === 0) {
        chordNotes = [baseFreqs[0] / 2, baseFreqs[3], baseFreqs[5 % N]];
      } else if (this.currentMeasure === 1) {
        chordNotes = [baseFreqs[2] / 2, baseFreqs[5 % N], baseFreqs[7 % N]];
      } else if (this.currentMeasure === 2) {
        chordNotes = [baseFreqs[1] / 2, baseFreqs[4], baseFreqs[6 % N]];
      } else {
        chordNotes = [baseFreqs[3] / 2, baseFreqs[6 % N], baseFreqs[0] * 2];
      }
    }

    chordNotes.forEach(freq => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();

      // 使用三角波合成，比锯齿波更温和空灵，适合做 Pad 背景铺底
      osc.type = 'triangle';
      osc.frequency.value = freq;

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(300, time);
      filter.frequency.exponentialRampToValueAtTime(150, time + 2.5);

      gain.gain.setValueAtTime(0.0, time);
      gain.gain.linearRampToValueAtTime(0.2, time + 0.5);
      gain.gain.exponentialRampToValueAtTime(0.001, time + 2.6);

      osc.connect(filter);
      filter.connect(gain);
      gain.connect(this.nodes.voice.panner);

      osc.start(time);
      osc.stop(time + 2.7);
    });
  }

  /**
   * 热加载外界录制的环境音采样
   * @param {AudioBuffer} audioBuffer 麦克风录制的 PCM 音频缓冲
   */
  loadCustomAmbientBuffer(audioBuffer) {
    if (!this.isPlaying || !this.audioCtx) return;
    this.customAmbientBuffer = audioBuffer;
    
    // 如果当前氛围音轨正在播放，执行热切换
    if (this.ambientSource) {
      try { this.ambientSource.stop(); } catch(e) {}
      this.ambientSource.disconnect();
    }
    
    const ctx = this.audioCtx;
    this.ambientSource = ctx.createBufferSource();
    this.ambientSource.buffer = audioBuffer;
    this.ambientSource.loop = true;
    this.ambientSource.connect(this.ambientFilter);
    this.ambientSource.start();
  }

  /**
   * 更新碳元素的氛围声音预设
   * @param {string} presetName 氛围声音预设名称 (respiration | tides | recorded)
   */
  updateAmbientPreset(presetName) {
    if (!this.isPlaying || !this.audioCtx) return;
    this.activePresets.ambient = presetName;
    
    if (presetName === 'tides') {
      // 潮汐预设：扫频周期拉长
      this.ambientLfo.frequency.setTargetAtTime(0.05, this.audioCtx.currentTime, 1.0);
    } else {
      // 恢复常规呼吸起伏周期
      this.ambientLfo.frequency.setTargetAtTime(0.15, this.audioCtx.currentTime, 1.0);
    }
    
    // 如果切换为录音模式且有录音数据
    if (presetName === 'recorded') {
      if (this.customAmbientBuffer) {
        this.loadCustomAmbientBuffer(this.customAmbientBuffer);
      }
    } else {
      // 恢复为默认白噪声循环
      if (this.ambientSource) {
        try { this.ambientSource.stop(); } catch(e) {}
        this.ambientSource.disconnect();
      }
      const ctx = this.audioCtx;
      this.ambientSource = ctx.createBufferSource();
      this.ambientSource.buffer = this.noiseBuffer;
      this.ambientSource.loop = true;
      this.ambientSource.connect(this.ambientFilter);
      this.ambientSource.start();
    }
  }

  /**
   * 实时键盘演奏发声接口 (按 A-K 键触发)
   * @param {number} pitchIndex 对应音阶中第几个音符 (0-7)
   */
  playManualNote(pitchIndex) {
    if (!this.isPlaying || !this.audioCtx) return;
    const ctx = this.audioCtx;
    const scale = this.scales[this.currentScale];
    
    // 映射到音阶内的基频
    const freq = scale[pitchIndex % scale.length];
    
    // 通过旋律声像节点实时触发高灵敏度的拨弦合成音
    AudioSynthesizer.synthPluck(ctx, this.nodes.melody.panner, freq, ctx.currentTime);
  }

  /**
   * 实时沙盘点击发声接口 (根据点击物理位置合成 3D 空间音符)
   * @param {number} x 点击点 X
   * @param {number} y 点击点 Y
   * @param {number} centerX 沙盘中心 X
   * @param {number} centerY 沙盘中心 Y
   * @param {number} radius 沙盘监听半径
   */
  playClickNote(x, y, centerX, centerY, radius) {
    if (!this.isPlaying || !this.audioCtx) return;
    const ctx = this.audioCtx;
    
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // 距离中心越近，音高越高。离边缘越近，音高越低
    const scale = this.scales[this.currentScale];
    const maxDist = radius;
    const ratio = Math.max(0, Math.min(1, distance / maxDist));
    const pitchIndex = Math.floor((1 - ratio) * scale.length);
    const freq = scale[Math.max(0, Math.min(scale.length - 1, pitchIndex))];
    
    // 动态创建一次性空间声像定位器，保留点击处的 3D 二维声像效果
    const clickPanner = ctx.createPanner();
    SpatialAudio.updatePannerPosition(clickPanner, dx / radius, dy / radius, ctx);
    
    const clickGain = ctx.createGain();
    clickGain.gain.setValueAtTime(0.4, ctx.currentTime);
    
    clickPanner.connect(clickGain);
    clickGain.connect(this.analyser);
    
    AudioSynthesizer.synthPluck(ctx, clickPanner, freq, ctx.currentTime);
  }
}
