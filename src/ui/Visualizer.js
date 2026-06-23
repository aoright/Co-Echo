/**
 * Visualizer.js
 * 
 * 频谱分析可视化渲染模块。
 * 本模块获取 Web Audio 分析器（AnalyserNode）的字节频段能量，
 * 并将其动态映射为控制台频谱柱的高度，呈现出高频与低频声波波动的交互视觉。
 */

export class Visualizer {
  /**
   * 
   * @param {NodeList} barElements 频谱柱的 DOM 节点列表
   */
  constructor(barElements) {
    this.bars = barElements;
    this.frequencyData = new Uint8Array(32); // 32 频段数据缓存
  }

  /**
   * 刷新频谱柱高度。
   * 
   * @param {AnalyserNode} analyserNode Web Audio API 频谱分析节点
   */
  update(analyserNode) {
    if (!analyserNode || this.bars.length === 0) return;

    analyserNode.getByteFrequencyData(this.frequencyData);

    this.bars.forEach((bar, index) => {
      // 采样低频到高频的不同步长
      const val = this.frequencyData[index % 16];
      // 归一化高度比例，设置最小高度 8% 以防频谱柱彻底消失
      const heightPercent = Math.min(100, Math.max(8, (val / 255) * 100));
      
      bar.style.height = `${heightPercent}%`;
      bar.style.backgroundColor = '#111111'; // 极简灰黑色度
    });
  }
}
