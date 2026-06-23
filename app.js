/* ==========================================
   【共鸣回廊】 声音合成与交互系统 (Minimalist Light Version)
   ========================================== */

class SoundEngine {
  constructor() {
    this.audioCtx = null;
    this.analyser = null;
    this.isPlaying = false;
    
    // 房间音乐配置
    this.bpm = 90;
    this.currentScale = 'major-pentatonic';
    
    // 元素合成节点与状态
    this.nodes = {
      beat: { gain: null, panner: null, active: false },
      melody: { gain: null, panner: null, active: false },
      voice: { gain: null, panner: null, active: false },
      ambient: { gain: null, panner: null, active: false },
      bass: { osc: null, gain: null, active: false }
    };
    
    // 效果器节点 (空间延迟效果器)
    this.effects = {
      melodyDelay: null,
      melodyFeedback: null,
      voiceDelay: null,
      voiceFeedback: null
    };

    // 录音节点
    this.recordingDest = null;
    this.masterRecorder = null;
    this.masterChunks = [];
    this.isRecordingMaster = false;

    // 自定义人声录音缓存
    this.micRecordedBuffer = null;
    this.voiceBufferSource = null;
    
    // 调度器计时器
    this.schedulerTimer = null;
    this.nextStepTime = 0.0;
    this.currentStep = 0;
    this.lookahead = 25.0; // ms
    this.scheduleAheadTime = 0.1; // s
    
    // 音符频段配置
    this.scales = {
      'major-pentatonic': [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25], // C Major Pentatonic
      'minor-pentatonic': [220.00, 261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33], // A Minor Pentatonic
      'lydian': [261.63, 293.66, 329.63, 369.99, 392.00, 440.00, 493.88, 523.25],           // C Lydian
      'dorian': [293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25, 587.33]            // D Dorian
    };

    this.noiseBuffer = null;
  }

  // 初始化 Web Audio API
  init() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    this.audioCtx = new AudioContext();
    
    // 创建全局分析器与主输出混合器
    this.analyser = this.audioCtx.createAnalyser();
    this.analyser.fftSize = 64;
    this.analyser.connect(this.audioCtx.destination);

    // 录音分流通道：将分析器连接到 MediaStreamAudioDestinationNode
    this.recordingDest = this.audioCtx.createMediaStreamDestination();
    this.analyser.connect(this.recordingDest);

    // 预生成白噪声 Buffer
    this.noiseBuffer = this.createNoiseBuffer();

    // 初始化音轨通道与延时反馈效果器
    this.initTracks();
    this.isPlaying = true;
    
    // 启动节奏调度器
    this.nextStepTime = this.audioCtx.currentTime;
    this.scheduler();

    // 启动持续声源
    this.startContinuousSounds();
  }

  // 释放/关闭音频
  close() {
    if (this.audioCtx) {
      clearTimeout(this.schedulerTimer);
      this.stopContinuousSounds();
      this.audioCtx.close();
      this.audioCtx = null;
      this.isPlaying = false;
      this.isRecordingMaster = false;
      this.masterRecorder = null;
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

  // 初始化音轨通道并加入空间回声效果器 (Algorithmic Space Echo)
  initTracks() {
    const ctx = this.audioCtx;

    // 1. 节奏通道 (Beat)
    this.nodes.beat.panner = ctx.createPanner();
    this.nodes.beat.gain = ctx.createGain();
    this.nodes.beat.gain.gain.value = 0.0;
    this.configurePanner(this.nodes.beat.panner);
    this.nodes.beat.panner.connect(this.nodes.beat.gain);
    this.nodes.beat.gain.connect(this.analyser);

    // 2. 旋律通道 (Melody) + 延时效果器 (Delay)
    this.nodes.melody.panner = ctx.createPanner();
    this.nodes.melody.gain = ctx.createGain();
    this.nodes.melody.gain.gain.value = 0.0;
    this.configurePanner(this.nodes.melody.panner);

    // 延时反馈效果器配置 (Delay Time = 0.35s, Feedback = 40%)
    this.effects.melodyDelay = ctx.createDelay(1.0);
    this.effects.melodyDelay.delayTime.value = 0.35;
    this.effects.melodyFeedback = ctx.createGain();
    this.effects.melodyFeedback.gain.value = 0.4;

    // 连线：Panner -> Gain -> Output 
    // 同时：Panner -> Delay -> Feedback -> Panner (环形回音回路)
    this.nodes.melody.panner.connect(this.nodes.melody.gain);
    this.nodes.melody.panner.connect(this.effects.melodyDelay);
    this.effects.melodyDelay.connect(this.effects.melodyFeedback);
    this.effects.melodyFeedback.connect(this.effects.melodyDelay); // 回路
    this.effects.melodyFeedback.connect(this.nodes.melody.gain); // 输出回音

    this.nodes.melody.gain.connect(this.analyser);

    // 3. 人声通道 (Voice) + 延时效果器
    this.nodes.voice.panner = ctx.createPanner();
    this.nodes.voice.gain = ctx.createGain();
    this.nodes.voice.gain.gain.value = 0.0;
    this.configurePanner(this.nodes.voice.panner);

    // 延时反馈效果器配置 (Delay Time = 0.5s, Feedback = 30%)
    this.effects.voiceDelay = ctx.createDelay(1.0);
    this.effects.voiceDelay.delayTime.value = 0.5;
    this.effects.voiceFeedback = ctx.createGain();
    this.effects.voiceFeedback.gain.value = 0.3;

    this.nodes.voice.panner.connect(this.nodes.voice.gain);
    this.nodes.voice.panner.connect(this.effects.voiceDelay);
    this.effects.voiceDelay.connect(this.effects.voiceFeedback);
    this.effects.voiceFeedback.connect(this.effects.voiceDelay);
    this.effects.voiceFeedback.connect(this.nodes.voice.gain);

    this.nodes.voice.gain.connect(this.analyser);

    // 4. 氛围通道 (Ambient)
    this.nodes.ambient.panner = ctx.createPanner();
    this.nodes.ambient.gain = ctx.createGain();
    this.nodes.ambient.gain.gain.value = 0.0;
    this.configurePanner(this.nodes.ambient.panner);
    this.nodes.ambient.panner.connect(this.nodes.ambient.gain);
    this.nodes.ambient.gain.connect(this.analyser);

    // 5. AI Bass 通道
    this.nodes.bass.gain = ctx.createGain();
    this.nodes.bass.gain.gain.value = 0.0;
    this.nodes.bass.gain.connect(this.analyser);
  }

  configurePanner(panner) {
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'exponential';
    panner.refDistance = 1;
    panner.maxDistance = 1000;
    panner.rolloffFactor = 1;
    panner.coneInnerAngle = 360;
    panner.coneOuterAngle = 360;
  }

  updateTrackSpatial(trackName, x, y, volume) {
    if (!this.isPlaying || !this.audioCtx) return;
    
    const track = this.nodes[trackName];
    if (!track || !track.panner || !track.gain) return;

    const posX = x * 4;
    const posY = y * 4;
    
    track.panner.positionX.setValueAtTime(posX, this.audioCtx.currentTime);
    track.panner.positionZ.setValueAtTime(-posY, this.audioCtx.currentTime); 
    track.panner.positionY.setValueAtTime(0, this.audioCtx.currentTime); 

    track.gain.gain.setTargetAtTime(volume, this.audioCtx.currentTime, 0.1);
  }

  // 持续声源控制
  startContinuousSounds() {
    const ctx = this.audioCtx;

    // 【人声 Pad (氮元素)】：如果用户录制了自定义人声，则循环播放用户声音；否则使用合成器
    if (this.micRecordedBuffer) {
      this.voiceBufferSource = ctx.createBufferSource();
      this.voiceBufferSource.buffer = this.micRecordedBuffer;
      this.voiceBufferSource.loop = true;
      this.voiceBufferSource.connect(this.nodes.voice.panner);
      this.voiceBufferSource.start();
    } else {
      this.voiceOsc1 = ctx.createOscillator();
      this.voiceOsc2 = ctx.createOscillator();
      this.voiceFilter = ctx.createBiquadFilter();

      this.voiceOsc1.type = 'sawtooth';
      this.voiceOsc2.type = 'sawtooth';
      this.voiceOsc1.frequency.value = 220; // A3
      this.voiceOsc2.frequency.value = 220.5;

      this.voiceFilter.type = 'lowpass';
      this.voiceFilter.frequency.value = 350;

      this.voiceOsc1.connect(this.voiceFilter);
      this.voiceOsc2.connect(this.voiceFilter);
      this.voiceFilter.connect(this.nodes.voice.panner);

      this.voiceOsc1.start();
      this.voiceOsc2.start();
    }

    // 【环境氛围 (碳元素)】
    this.ambientSource = ctx.createBufferSource();
    this.ambientSource.buffer = this.noiseBuffer;
    this.ambientSource.loop = true;

    this.ambientFilter = ctx.createBiquadFilter();
    this.ambientFilter.type = 'lowpass';
    this.ambientFilter.frequency.value = 400;
    this.ambientFilter.Q.value = 1.0;

    this.ambientLfo = ctx.createOscillator();
    this.ambientLfo.frequency.value = 0.15;
    this.ambientLfoGain = ctx.createGain();
    this.ambientLfoGain.gain.value = 250;

    this.ambientLfo.connect(this.ambientLfoGain);
    this.ambientLfoGain.connect(this.ambientFilter.frequency);
    
    this.ambientSource.connect(this.ambientFilter);
    this.ambientFilter.connect(this.nodes.ambient.panner);

    this.ambientLfo.start();
    this.ambientSource.start();

    // 【AI Bassline】
    this.bassOsc = ctx.createOscillator();
    this.bassOsc.type = 'sine';
    this.bassOsc.frequency.value = 55;
    this.bassOsc.connect(this.nodes.bass.gain);
    this.bassOsc.start();
  }

  // 重新加载人声声源（用于录音结束后无缝切换）
  reloadVoiceSource() {
    if (!this.isPlaying || !this.audioCtx) return;

    // 停止并清理当前人声音源
    if (this.voiceBufferSource) {
      try { this.voiceBufferSource.stop(); } catch(e) {}
      this.voiceBufferSource.disconnect();
    }
    if (this.voiceOsc1) {
      try {
        this.voiceOsc1.stop();
        this.voiceOsc2.stop();
      } catch(e) {}
      this.voiceOsc1.disconnect();
      this.voiceOsc2.disconnect();
      this.voiceFilter.disconnect();
    }

    // 重新启动人声通道声源
    const ctx = this.audioCtx;
    if (this.micRecordedBuffer) {
      this.voiceBufferSource = ctx.createBufferSource();
      this.voiceBufferSource.buffer = this.micRecordedBuffer;
      this.voiceBufferSource.loop = true;
      this.voiceBufferSource.connect(this.nodes.voice.panner);
      this.voiceBufferSource.start();
    }
  }

  stopContinuousSounds() {
    try {
      if (this.voiceOsc1) this.voiceOsc1.stop();
      if (this.voiceOsc2) this.voiceOsc2.stop();
      if (this.voiceBufferSource) this.voiceBufferSource.stop();
      if (this.ambientSource) this.ambientSource.stop();
      if (this.ambientLfo) this.ambientLfo.stop();
      if (this.bassOsc) this.bassOsc.stop();
    } catch (e) {
      console.warn("停止持续声源时出错: ", e);
    }
  }

  // Sequencer 逻辑
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
    if (this.nodes.beat.gain.gain.value > 0.01) {
      if (step === 0 || step === 4 || step === 8 || step === 12) {
        this.synthKick(time);
      }
      if (step === 2 || step === 6 || step === 10 || step === 14) {
        this.synthHiHat(time);
      }
      if (step === 8) {
        this.synthSnare(time);
      }
    }

    if (this.nodes.melody.gain.gain.value > 0.01) {
      if (step % 2 === 0) {
        const scale = this.scales[this.currentScale];
        const melPattern = [0, 4, 2, 6, 1, 5, 3, 7, 4, 2, 5, 3, 0, 4, 1, 6];
        const noteIndex = melPattern[step];
        const freq = scale[noteIndex];
        this.synthPluck(freq, time);
      }
    }
  }

  synthKick(time) {
    const ctx = this.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.08);

    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

    osc.connect(gain);
    gain.connect(this.nodes.beat.panner);

    osc.start(time);
    osc.stop(time + 0.16);
  }

  synthSnare(time) {
    const ctx = this.audioCtx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const noise = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, time);
    osc.frequency.linearRampToValueAtTime(100, time + 0.07);

    noise.buffer = this.noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = 1000;

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.4, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

    osc.connect(gain);
    gain.connect(this.nodes.beat.panner);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(this.nodes.beat.panner);

    osc.start(time);
    noise.start(time);

    osc.stop(time + 0.15);
    noise.stop(time + 0.15);
  }

  synthHiHat(time) {
    const ctx = this.audioCtx;
    const source = ctx.createBufferSource();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    source.buffer = this.noiseBuffer;
    filter.type = 'highpass';
    filter.frequency.value = 7000;

    gain.gain.setValueAtTime(0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this.nodes.beat.panner);

    source.start(time);
    source.stop(time + 0.05);
  }

  synthPluck(freq, time) {
    const ctx = this.audioCtx;
    const osc = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1500, time);
    filter.frequency.exponentialRampToValueAtTime(200, time + 0.2);

    gain.gain.setValueAtTime(0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.nodes.melody.panner);

    osc.start(time);
    osc.stop(time + 0.4);
  }

  setBassActive(isActive, multiplier = 1.0) {
    if (!this.isPlaying || !this.audioCtx) return;
    
    const targetGain = isActive ? 0.35 * multiplier : 0.0;
    this.nodes.bass.gain.gain.setTargetAtTime(targetGain, this.audioCtx.currentTime, 0.2);
    
    if (isActive) {
      const rootFreq = this.scales[this.currentScale][0] / 4;
      this.bassOsc.frequency.setTargetAtTime(rootFreq, this.audioCtx.currentTime, 0.3);
    }
  }

  setVocalModulation(isActive) {
    if (!this.isPlaying || !this.audioCtx) return;

    if (isActive && this.voiceFilter) {
      const now = this.audioCtx.currentTime;
      this.voiceFilter.frequency.cancelScheduledValues(now);
      this.voiceFilter.frequency.setTargetAtTime(400 + Math.sin(now * 3) * 200, now, 0.1);
    } else if (this.voiceFilter) {
      this.voiceFilter.frequency.setTargetAtTime(350, this.audioCtx.currentTime, 0.5);
    }
  }

  // --- 全局作品录制功能 ---
  startMasterRecording() {
    if (!this.isPlaying || !this.recordingDest) return;
    this.masterChunks = [];
    this.masterRecorder = new MediaRecorder(this.recordingDest.stream, { mimeType: 'audio/webm' });
    
    this.masterRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.masterChunks.push(e.data);
      }
    };

    this.masterRecorder.onstop = () => {
      this.exportMasterWav();
    };

    this.masterRecorder.start();
    this.isRecordingMaster = true;
  }

  stopMasterRecording() {
    if (this.masterRecorder && this.isRecordingMaster) {
      this.masterRecorder.stop();
      this.isRecordingMaster = false;
    }
  }

  exportMasterWav() {
    const blob = new Blob(this.masterChunks, { type: 'audio/webm' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '共鸣回廊_声音化学合成作品.webm';
    a.click();
    URL.revokeObjectURL(url);
  }
}

// ==========================================
//   UI 交互、拖拽物理（Lerp）与协作模拟
// ==========================================

document.addEventListener('DOMContentLoaded', () => {
  const engine = new SoundEngine();
  
  // UI 绑定
  const btnToggleAudio = document.getElementById('btn-toggle-audio');
  const btnText = document.getElementById('btn-text');
  const btnRecordMic = document.getElementById('btn-record-mic');
  const btnMicText = document.getElementById('btn-mic-text');
  const btnExportRecording = document.getElementById('btn-export-recording');
  const btnExportText = document.getElementById('btn-export-text');
  
  const roomStatusText = document.getElementById('room-status-text');
  const statusDot = document.querySelector('.status-dot');
  const recordingBadge = document.getElementById('recording-badge');
  const sliderBpm = document.getElementById('slider-bpm');
  const valBpm = document.getElementById('val-bpm');
  const selectScale = document.getElementById('select-scale');
  const logContainer = document.getElementById('log-container');
  const sandbox = document.getElementById('sandbox');
  const canvas = document.getElementById('connection-canvas');
  const ctx = canvas.getContext('2d');
  
  const elements = {
    beat: document.getElementById('el-beat'),
    melody: document.getElementById('el-melody'),
    voice: document.getElementById('el-voice'),
    ambient: document.getElementById('el-ambient')
  };

  // 物理惯性 (Lerp) 状态控制
  // targetX, targetY 为目标百分比坐标
  // currentX, currentY 为当前实际百分比坐标
  const bubblePhysics = {
    beat: { currentX: 20, currentY: 25, targetX: 20, targetY: 25, dragging: false },
    melody: { currentX: 80, currentY: 30, targetX: 80, targetY: 30, dragging: false },
    voice: { currentX: 30, currentY: 75, targetX: 30, targetY: 75, dragging: false },
    ambient: { currentX: 70, currentY: 70, targetX: 70, targetY: 70, dragging: false }
  };
  
  let dragKey = null; // 当前拖拽的元素键值
  let sandboxRect = null;
  let sandboxRadius = 0;
  
  const reactionStatus = {
    beatMelody: false,
    voiceAmbient: false,
    allFour: false
  };

  // 麦克风录音状态
  let isRecordingMic = false;
  let micMediaRecorder = null;
  let micChunks = [];
  let micTimeout = null;

  function resizeCanvas() {
    sandboxRect = sandbox.getBoundingClientRect();
    sandboxRadius = sandboxRect.width / 2;
    canvas.width = sandboxRect.width;
    canvas.height = sandboxRect.height;
  }
  
  resizeCanvas();
  window.addEventListener('resize', resizeCanvas);

  // 1. 声音引擎启停控制
  btnToggleAudio.addEventListener('click', () => {
    if (!engine.isPlaying) {
      try {
        engine.init();
        engine.bpm = parseInt(sliderBpm.value);
        engine.currentScale = selectScale.value;
        
        btnToggleAudio.classList.remove('btn-primary');
        btnToggleAudio.classList.add('btn-stop');
        btnText.textContent = "暂停共鸣空间";
        
        roomStatusText.textContent = "声音共创中";
        statusDot.classList.remove('pulsing');
        statusDot.classList.add('active');
        
        // 激活功能按钮
        sliderBpm.removeAttribute('disabled');
        selectScale.removeAttribute('disabled');
        btnRecordMic.removeAttribute('disabled');
        btnExportRecording.removeAttribute('disabled');
        
        addLog("[系统] 共鸣空间已激活。Web Audio 合成引擎已就绪。", "system");
        
        Object.values(elements).forEach(el => el.classList.add('active'));
        
        requestAnimationFrame(updateFrame);
      } catch (err) {
        addLog(`[系统错误] 音频启动失败: ${err.message}`, "system");
        console.error(err);
      }
    } else {
      // 停止录音 (防止在录音状态下直接关闭引擎)
      if (engine.isRecordingMaster) {
        stopMasterRecordingHelper();
      }
      if (isRecordingMic) {
        stopMicRecordingHelper(true);
      }

      engine.close();
      
      btnToggleAudio.classList.remove('btn-stop');
      btnToggleAudio.classList.add('btn-primary');
      btnText.textContent = "激活共鸣空间";
      
      roomStatusText.textContent = "待激活实验室";
      statusDot.classList.remove('active');
      statusDot.classList.add('pulsing');
      
      // 禁用功能按钮
      sliderBpm.setAttribute('disabled', 'true');
      selectScale.setAttribute('disabled', 'true');
      btnRecordMic.setAttribute('disabled', 'true');
      btnExportRecording.setAttribute('disabled', 'true');
      
      addLog("[系统] 共鸣空间已暂停。声音流已释放。", "system");
      
      Object.values(elements).forEach(el => el.classList.remove('active'));
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
  });

  // 2. 麦克风录音自定义人声
  btnRecordMic.addEventListener('click', () => {
    if (!engine.isPlaying) return;
    
    if (!isRecordingMic) {
      // 开始录制
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          isRecordingMic = true;
          micChunks = [];
          micMediaRecorder = new MediaRecorder(stream);
          
          micMediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) micChunks.push(e.data);
          };
          
          micMediaRecorder.onstop = () => {
            const blob = new Blob(micChunks, { type: 'audio/webm' });
            
            // 将 Blob 转化为 AudioBuffer 供 Web Audio 循环播放
            blob.arrayBuffer()
              .then(arrayBuffer => engine.audioCtx.decodeAudioData(arrayBuffer))
              .then(audioBuffer => {
                engine.micRecordedBuffer = audioBuffer;
                engine.reloadVoiceSource();
                addLog("[人声素材] 你的录音已加载到氮(VOICE)元素，正在空间循环演奏。", "interaction");
              })
              .catch(err => {
                addLog(`[录音解码失败] 无法加载音频: ${err.message}`, "system");
              });

            // 停用麦克风物理轨道
            stream.getTracks().forEach(track => track.stop());
          };

          micMediaRecorder.start();
          btnRecordMic.classList.remove('btn-secondary');
          btnRecordMic.classList.add('btn-recording');
          btnMicText.textContent = "录音中 (最长3秒)...";

          // 3秒后自动停止录音
          micTimeout = setTimeout(() => {
            stopMicRecordingHelper(false);
          }, 3000);
        })
        .catch(err => {
          addLog(`[麦克风错误] 无法获取权限: ${err.message}`, "system");
        });
    } else {
      // 手动提前停止录音
      stopMicRecordingHelper(false);
    }
  });

  function stopMicRecordingHelper(isAborted = false) {
    if (micTimeout) clearTimeout(micTimeout);
    
    if (micMediaRecorder && micMediaRecorder.state !== 'inactive') {
      if (isAborted) {
        // 如果是异常终止，直接清空事件避免解码
        micMediaRecorder.onstop = null;
      }
      micMediaRecorder.stop();
    }
    
    isRecordingMic = false;
    btnRecordMic.classList.remove('btn-recording');
    btnRecordMic.classList.add('btn-secondary');
    btnMicText.textContent = "录制人声片段";
  }

  // 3. 作品录制与导出
  btnExportRecording.addEventListener('click', () => {
    if (!engine.isPlaying) return;

    if (!engine.isRecordingMaster) {
      // 开启录音
      engine.startMasterRecording();
      btnExportRecording.classList.remove('btn-secondary');
      btnExportRecording.classList.add('btn-recording');
      btnExportText.textContent = "停止并导出作品";
      recordingBadge.classList.remove('hidden');
      addLog("[作品录制] 开始录制当前共鸣空间的所有音轨混音。", "system");
    } else {
      stopMasterRecordingHelper();
    }
  });

  function stopMasterRecordingHelper() {
    engine.stopMasterRecording();
    btnExportRecording.classList.remove('btn-recording');
    btnExportRecording.classList.add('btn-secondary');
    btnExportText.textContent = "开始录制作品";
    recordingBadge.classList.add('hidden');
    addLog("[作品录制] 录音已结束，文件开始导出下载。", "system");
  }

  // 4. 参数控制绑定
  sliderBpm.addEventListener('input', (e) => {
    const val = e.target.value;
    valBpm.textContent = val;
    engine.bpm = parseInt(val);
  });

  selectScale.addEventListener('change', (e) => {
    const val = e.target.value;
    engine.currentScale = val;
    const scaleName = selectScale.options[selectScale.selectedIndex].text;
    addLog(`[音阶调整] 当前房间重映射为: ${scaleName}`, "interaction");
  });

  // 5. 气泡拖拽鼠标事件
  Object.entries(elements).forEach(([key, el]) => {
    el.addEventListener('mousedown', (e) => startDrag(e, key));
    el.addEventListener('touchstart', (e) => startDrag(e, key), { passive: false });
  });

  function startDrag(e, key) {
    if (!engine.isPlaying) {
      addLog("[提示] 请先激活音频空间，再移动声音气泡。", "system");
      return;
    }
    
    e.preventDefault();
    dragKey = key;
    bubblePhysics[key].dragging = true;
    
    document.addEventListener('mousemove', dragMove);
    document.addEventListener('touchmove', dragMove, { passive: false });
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);
  }

  function dragMove(e) {
    if (!dragKey) return;
    
    let clientX, clientY;
    if (e.touches) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    
    sandboxRect = sandbox.getBoundingClientRect();
    sandboxRadius = sandboxRect.width / 2;
    
    const centerX = sandboxRect.left + sandboxRadius;
    const centerY = sandboxRect.top + sandboxRadius;
    const dx = clientX - centerX;
    const dy = clientY - centerY;
    
    const dist = Math.sqrt(dx * dx + dy * dy);
    const maxAllowedRadius = sandboxRadius - 36;
    
    let targetX = dx;
    let targetY = dy;
    
    if (dist > maxAllowedRadius) {
      targetX = (dx / dist) * maxAllowedRadius;
      targetY = (dy / dist) * maxAllowedRadius;
    }
    
    // 更新物理的 target 坐标百分比
    const percentX = ((targetX + sandboxRadius) / sandboxRect.width) * 100;
    const percentY = ((targetY + sandboxRadius) / sandboxRect.height) * 100;
    
    bubblePhysics[dragKey].targetX = percentX;
    bubblePhysics[dragKey].targetY = percentY;
  }

  function stopDrag() {
    if (dragKey) {
      bubblePhysics[dragKey].dragging = false;
    }
    dragKey = null;
    document.removeEventListener('mousemove', dragMove);
    document.removeEventListener('touchmove', dragMove);
    document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchend', stopDrag);
  }

  // 6. 协作角色模拟漂浮 (Multiplayer wandering simulation)
  // 当用户没有拖拽特定元素时，其他元素（如 beat、ambient）在背景缓慢漂移，模拟其他人控制的动态
  function simulateMultiplayer(timestamp) {
    const timeScale = timestamp * 0.0005;
    
    // 模拟用户 A 移动 H 元素 (Beat)
    if (!bubblePhysics.beat.dragging && dragKey !== 'beat') {
      const beatOffsetScale = 6; // 偏移范围半径 %
      // 以默认位置 (20%, 25%) 为轴心漂浮
      bubblePhysics.beat.targetX = 20 + Math.sin(timeScale) * beatOffsetScale;
      bubblePhysics.beat.targetY = 25 + Math.cos(timeScale * 0.8) * beatOffsetScale;
    }

    // 模拟用户 B 移动 C 元素 (Ambient)
    if (!bubblePhysics.ambient.dragging && dragKey !== 'ambient') {
      const ambOffsetScale = 8;
      // 以默认位置 (70%, 70%) 为轴心漂浮
      bubblePhysics.ambient.targetX = 70 + Math.cos(timeScale * 0.6 + 1.2) * ambOffsetScale;
      bubblePhysics.ambient.targetY = 70 + Math.sin(timeScale * 0.7) * ambOffsetScale;
    }
  }

  // 7. 动画帧循环：Inertia Lerp 计算、Canvas 绘制与距离判定
  const visualizerBars = document.querySelectorAll('.visualizer-bars .bar');
  const frequencyData = new Uint8Array(32);
  
  function updateFrame(timestamp) {
    if (!engine.isPlaying) return;
    
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const cX = canvas.width / 2;
    const cY = canvas.height / 2;
    
    // 模拟多人动态
    simulateMultiplayer(timestamp);
    
    const coords = {};
    const normalizedCoords = {};
    const distances = {};
    
    const maxAllowedRadius = sandboxRadius - 36;
    const warningThreshold = maxAllowedRadius * 0.82; // 临界报警距离 (px)
    let isAnyBubbleNearBoundary = false;

    // 针对每个气泡执行物理 Lerp 惯性滑行并更新 DOM
    Object.entries(elements).forEach(([key, el]) => {
      const phys = bubblePhysics[key];
      
      // 平滑插值：当前位置以 12% 的比例向目标位置推进 (Lerp)
      phys.currentX += (phys.targetX - phys.currentX) * 0.12;
      phys.currentY += (phys.targetY - phys.currentY) * 0.12;
      
      // 写入 DOM 表现
      el.style.left = `${phys.currentX}%`;
      el.style.top = `${phys.currentY}%`;
      
      // 像素坐标与音效计算
      const pX = (phys.currentX / 100) * canvas.width;
      const pY = (phys.currentY / 100) * canvas.height;
      coords[key] = { x: pX, y: pY };

      const normX = (pX - cX) / sandboxRadius;
      const normY = -(pY - cY) / sandboxRadius;
      normalizedCoords[key] = { x: normX, y: normY };

      const dx = pX - cX;
      const dy = pY - cY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      // 判断是否有任何一个气泡贴近最外边界
      if (dist > warningThreshold) {
        isAnyBubbleNearBoundary = true;
      }
      
      let gain = Math.max(0, 1 - (dist / maxAllowedRadius));
      gain = Math.pow(gain, 1.5);
      distances[key] = gain;

      engine.updateTrackSpatial(key, normX, normY, gain);
      
      // 极细的灰色指示线
      ctx.beginPath();
      ctx.moveTo(cX, cY);
      ctx.lineTo(pX, pY);
      ctx.strokeStyle = `rgba(17, 17, 17, ${gain * 0.12})`;
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    // --- 边界警告视觉绘制 ---
    if (isAnyBubbleNearBoundary) {
      ctx.beginPath();
      ctx.arc(cX, cY, maxAllowedRadius, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)'; // 极简灰红虚线警告圈
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // --- 化学反应判定 ---
    const reactionThreshold = 120;
    
    // A. H + O (Beat + Melody)
    const dx_bm = coords.beat.x - coords.melody.x;
    const dy_bm = coords.beat.y - coords.melody.y;
    const dist_bm = Math.sqrt(dx_bm * dx_bm + dy_bm * dy_bm);
    
    if (dist_bm < reactionThreshold) {
      ctx.beginPath();
      ctx.moveTo(coords.beat.x, coords.beat.y);
      ctx.lineTo(coords.melody.x, coords.melody.y);
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      const bassStrength = 1.0 - (dist_bm / reactionThreshold);
      engine.setBassActive(true, bassStrength);

      if (!reactionStatus.beatMelody) {
        addLog("[化学反应] H(氢) + O(氧) 形成《律动分子》，AI 已激活重低音 Bass 轨。", "chemical");
        reactionStatus.beatMelody = true;
      }
    } else {
      if (reactionStatus.beatMelody) {
        engine.setBassActive(false);
        addLog("[化学解离] 《律动分子》解离，AI Bass 伴奏已退出。", "system");
        reactionStatus.beatMelody = false;
      }
    }

    // B. N + C (Voice + Ambient)
    const dx_va = coords.voice.x - coords.ambient.x;
    const dy_va = coords.voice.y - coords.ambient.y;
    const dist_va = Math.sqrt(dx_va * dx_va + dy_va * dy_va);
    
    if (dist_va < reactionThreshold) {
      ctx.beginPath();
      ctx.moveTo(coords.voice.x, coords.voice.y);
      ctx.lineTo(coords.ambient.x, coords.ambient.y);
      ctx.strokeStyle = '#555555';
      ctx.lineWidth = 1.2;
      ctx.stroke();

      engine.setVocalModulation(true);

      if (!reactionStatus.voiceAmbient) {
        addLog("[化学反应] N(氮) + C(碳) 形成《冥想空间》，氛围音轨进入低频滤波振荡。", "chemical");
        reactionStatus.voiceAmbient = true;
      }
    } else {
      if (reactionStatus.voiceAmbient) {
        engine.setVocalModulation(false);
        addLog("[化学解离] 《冥想空间》解离，环境音轨恢复常态。", "system");
        reactionStatus.voiceAmbient = false;
      }
    }

    // C. 四核共鸣
    const allNearCenter = distances.beat > 0.45 && distances.melody > 0.45 && distances.voice > 0.45 && distances.ambient > 0.45;
    if (allNearCenter) {
      ctx.beginPath();
      ctx.arc(cX, cY, sandboxRadius - 15, 0, Math.PI * 2);
      ctx.strokeStyle = '#111111';
      ctx.lineWidth = 1;
      ctx.stroke();

      if (!reactionStatus.allFour) {
        addLog("[完美共鸣] H + O + N + C 发生融合。四重声部达成均衡，共鸣效果完全开启。", "chemical");
        reactionStatus.allFour = true;
      }
    } else {
      reactionStatus.allFour = false;
    }

    // 8. 频谱渲染
    if (engine.analyser) {
      engine.analyser.getByteFrequencyData(frequencyData);
      visualizerBars.forEach((bar, index) => {
        const val = frequencyData[index % 16];
        const heightPercent = Math.min(100, Math.max(8, (val / 255) * 100));
        bar.style.height = `${heightPercent}%`;
        bar.style.backgroundColor = '#111111';
      });
    }

    requestAnimationFrame(updateFrame);
  }
});
