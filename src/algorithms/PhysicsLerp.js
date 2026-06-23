/**
 * PhysicsLerp.js
 * 
 * 物理平滑差值与边界限制算法模块。
 * 本模块负责气泡拖动松开后的惯性滑行效果计算（Linear Interpolation），
 * 以及确保气泡坐标被限制在二维圆形声学沙盘的边界内。
 */

export class PhysicsLerp {
  /**
   * 一阶线性插值（LERP）计算。
   * 公式：
   * Current = Current + (Target - Current) * Factor
   * 
   * @param {number} current 当前实际坐标
   * @param {number} target 鼠标或拖拽的目标坐标
   * @param {number} factor 缓动系数，取值范围 (0, 1]，数值越低惯性越强（本项目默认使用 0.12）
   * @returns {number} 逼近目标点后的新坐标
   */
  static lerp(current, target, factor = 0.12) {
    return current + (target - current) * factor;
  }

  /**
   * 将气泡坐标限制在圆形沙盘边界内。
   * 基于极坐标等比压缩算法。当气泡与圆心的欧氏距离超过最大容许半径时，
   * 将其投影至最大半径边界的圆周上。
   * 
   * 公式说明：
   * 1. 偏移向量：dx = x - centerX, dy = y - centerY
   * 2. 距离：d = sqrt(dx^2 + dy^2)
   * 3. 若 d > R_max，则约束坐标为：
   *    x_constrained = centerX + (dx / d) * R_max
   *    y_constrained = centerY + (dy / d) * R_max
   * 
   * @param {number} x 输入的横坐标 (px)
   * @param {number} y 输入的纵坐标 (px)
   * @param {number} centerX 圆心横坐标 (px)
   * @param {number} centerY 圆心纵坐标 (px)
   * @param {number} maxRadius 最大可滑动的物理半径 (px)
   * @returns {{x: number, y: number, isClamped: boolean}} 限制后的绝对坐标与是否触界标志
   */
  static clampToCircle(x, y, centerX, centerY, maxRadius) {
    const dx = x - centerX;
    const dy = y - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance > maxRadius) {
      return {
        x: centerX + (dx / distance) * maxRadius,
        y: centerY + (dy / distance) * maxRadius,
        isClamped: true
      };
    }

    return { x, y, isClamped: false };
  }
}
