/**
 * AudioSynthesizer.js
 * 
 * 实时音频减法合成与物理模拟发声算法模块。
 * 本模块使用 Web Audio 原生振荡器和滤波器，在不需要任何外部音频采样文件的情况下，
 * 实时合成打击乐声部（底鼓、小军鼓、镲片）与旋律声部（金属琶音拨弦音色）。
 */

export class AudioSynthesizer {
  /**
   * 合成 Kick Drum (电子底鼓)。
   * 采用频率指数下扫（Exponential Frequency Sweep）技术模拟鼓皮被敲击后的基频物理降频过程，
   * 同时施加指数增益衰减包络。
   * 
   * 频率下扫数学公式：
   * f(t) = (f_start - f_end) * e^(-k_f * t) + f_end
   * 本算法实现中，在 time 触发时设置频点 120Hz，并在 0.08 秒内指数下降至 45Hz。
   * 
   * 振幅包络公式：
   * a(t) = a_max * e^(-k_a * t)
   * 
   * @param {AudioContext} audioCtx 当前音频上下文
   * @param {AudioNode} outputDestination 输出连接的目的节点（如 PannerNode）
   * @param {number} time 触发的绝对音频系统时间 (s)
   */
  static synthKick(audioCtx, outputDestination, time) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.type = 'sine';
    
    // 底鼓频率快速下扫
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(45, time + 0.08);

    // 底鼓振幅衰减包络
    gain.gain.setValueAtTime(0.8, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.15);

    osc.connect(gain);
    gain.connect(outputDestination);

    osc.start(time);
    osc.stop(time + 0.16);
  }

  /**
   * 合成 Snare Drum (小军鼓)。
   * 物理模型解构：
   * 1. 鼓体共鸣（Body Resonance）：使用三角波快速降频模拟。
   * 2. 鼓网沙沙声（Snare Rattle）：使用经过带通滤波的白噪声（White Noise）和快速包络模拟。
   * 
   * @param {AudioContext} audioCtx 当前音频上下文
   * @param {AudioNode} outputDestination 输出目的地
   * @param {AudioBuffer} noiseBuffer 预生成的白噪声缓冲
   * @param {number} time 触发的绝对音频系统时间 (s)
   */
  static synthSnare(audioCtx, outputDestination, noiseBuffer, time) {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    const noise = audioCtx.createBufferSource();
    const filter = audioCtx.createBiquadFilter();
    const noiseGain = audioCtx.createGain();

    // 1. 鼓体共鸣波形
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, time);
    osc.frequency.linearRampToValueAtTime(100, time + 0.07);

    gain.gain.setValueAtTime(0.5, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.08);

    // 2. 鼓网噪声波形
    noise.buffer = noiseBuffer;
    filter.type = 'bandpass';
    filter.frequency.value = 1000; // 限制在中高频带通

    noiseGain.gain.setValueAtTime(0.4, time);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, time + 0.12);

    // 级联接线
    osc.connect(gain);
    gain.connect(outputDestination);

    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(outputDestination);

    osc.start(time);
    noise.start(time);

    osc.stop(time + 0.15);
    noise.stop(time + 0.15);
  }

  /**
   * 合成 Hi-Hat (闭嚓镲)。
   * 采用高通滤波白噪声（High-Pass Filtered White Noise）模拟金属镲片震动时产生的极高频随机摩擦声，
   * 施加极其短促的衰减曲线。
   * 
   * @param {AudioContext} audioCtx 当前音频上下文
   * @param {AudioNode} outputDestination 输出目的地
   * @param {AudioBuffer} noiseBuffer 白噪声缓冲
   * @param {number} time 触发时间
   */
  static synthHiHat(audioCtx, outputDestination, noiseBuffer, time) {
    const source = audioCtx.createBufferSource();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();

    source.buffer = noiseBuffer;
    
    // 截止频率在 7kHz 以上的高通滤波器，过滤所有低频，仅留下金属碎砂感
    filter.type = 'highpass';
    filter.frequency.value = 7000;

    // 衰减时长控制在 0.04 秒
    gain.gain.setValueAtTime(0.25, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(outputDestination);

    source.start(time);
    source.stop(time + 0.05);
  }

  /**
   * 合成 Pluck (旋律拨弦/金属音色)。
   * 采用减法合成逻辑。在发声瞬间使用截止频率包络下扫模拟弦被拨动时谐波丰富、
   * 随后高频谐波快速衰减变闷的声学现象。
   * 
   * 滤波器截止频率包络公式：
   * fc(t) = 1500 * e^(-k_c * t) + 200
   * 即发音时截止频率为 1500Hz，在 0.2 秒内指数下降到 200Hz。
   * 
   * @param {AudioContext} audioCtx 当前音频上下文
   * @param {AudioNode} outputDestination 输出目的地
   * @param {number} freq 目标琴弦基频 (Hz)
   * @param {number} time 触发时间
   */
  static synthPluck(audioCtx, outputDestination, freq, time) {
    const osc = audioCtx.createOscillator();
    const filter = audioCtx.createBiquadFilter();
    const gain = audioCtx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);

    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1500, time);
    filter.frequency.exponentialRampToValueAtTime(200, time + 0.2);

    gain.gain.setValueAtTime(0.6, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.35);

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(outputDestination);

    osc.start(time);
    osc.stop(time + 0.4);
  }
}
