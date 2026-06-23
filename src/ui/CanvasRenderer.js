/**
 * CanvasRenderer.js
 * 
 * 二维空间沙盘 Canvas 绘图与渲染器模块。
 * 负责绘制气泡与中轴线、分子化学反应连接线以及出界边缘报警环线。
 */

export class CanvasRenderer {
  /**
   * 
   * @param {HTMLCanvasElement} canvasElement 沙盘底部的 Canvas 元素
   */
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
  }

  /**
   * 清空画布。
   */
  clear() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  /**
   * 绘制气泡与中心 Listener (听众) 之间的极细指示虚线。
   * 指示线的不透明度随声音增益比值动态变化。
   * 
   * @param {number} pX 气泡横坐标
   * @param {number} pY 气泡纵坐标
   * @param {number} cX 中心横坐标
   * @param {number} cY 中心纵坐标
   * @param {number} gain 气泡对应声音的实时增益比 [0, 1]
   */
  drawListenerLink(pX, pY, cX, cY, gain) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(cX, cY);
    ctx.lineTo(pX, pY);
    
    // 不透明度由音量决定
    ctx.strokeStyle = `rgba(17, 17, 17, ${gain * 0.12})`;
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /**
   * 绘制化学反应强连接实线（化学键）。
   * 
   * @param {number} x1 元素 A 横坐标
   * @param {number} y1 元素 A 纵坐标
   * @param {number} x2 元素 B 横坐标
   * @param {number} y2 元素 B 纵坐标
   * @param {string} color 线条颜色代码（十六进制）
   * @param {number} lineWidth 线条宽度 (默认 1.2)
   */
  drawChemicalBond(x1, y1, x2, y2, color = '#111111', lineWidth = 1.2) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }

  /**
   * 绘制沙盘外边界碰撞警告红色圈。
   * 
   * @param {number} cX 中心横坐标
   * @param {number} cY 中心纵坐标
   * @param {number} maxAllowedRadius 沙盘发声最大限定半径
   */
  drawBoundaryWarning(cX, cY, maxAllowedRadius) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(cX, cY, maxAllowedRadius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(239, 68, 68, 0.2)'; // 极简灰红虚线警告圈
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();
    ctx.setLineDash([]); // 还原实线模式
  }

  /**
   * 绘制全共鸣金环线。
   * 
   * @param {number} cX 中心横坐标
   * @param {number} cY 中心纵坐标
   * @param {number} outerRadius 绘制环的绝对半径
   */
  drawPerfectResonanceRing(cX, cY, outerRadius) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(cX, cY, outerRadius, 0, Math.PI * 2);
    ctx.strokeStyle = '#111111';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}
