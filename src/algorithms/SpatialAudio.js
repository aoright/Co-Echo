/**
 * SpatialAudio.js
 * 
 * 3D 空间音频声场建模与能量衰减算法模块。
 * 本模块负责将沙盘上的二维物理坐标转换为双耳声学空间坐标，
 * 并使用声学反比平方比近似模型计算声音随物理距离的增益衰减。
 */

export class SpatialAudio {
  /**
   * 将画布上的绝对像素坐标转换为以中心为原点、半径归一化的空间音频笛卡尔坐标 [-1, 1]。
   * 
   * @param {number} pX 元素的绝对横坐标 (px)
   * @param {number} pY 元素的绝对纵坐标 (px)
   * @param {number} cX 沙盘圆心的绝对横坐标 (px)
   * @param {number} cY 沙盘圆心的绝对纵坐标 (px)
   * @param {number} radius 沙盘的参考物理半径 (px)
   * @returns {{x: number, y: number}} 归一化后的相对笛卡尔坐标
   */
  static normalizeCoordinates(pX, pY, cX, cY, radius) {
    return {
      x: (pX - cX) / radius,
      // 笛卡尔坐标系中Y轴向上，而屏幕坐标系中Y轴向下，故取反
      y: -(pY - cY) / radius
    };
  }

  /**
   * 计算基于距离的声能衰减指数增益（Distance Gain Decay）。
   * 本算法采用指数衰减模型模拟声波扩散：
   * Gain = max(0, 1 - d / R_max) ^ 1.5
   * 
   * @param {number} pX 元素横坐标
   * @param {number} pY 元素纵坐标
   * @param {number} cX 圆心横坐标
   * @param {number} cY 圆心纵坐标
   * @param {number} maxAllowedRadius 最大发声物理半径（气泡中心到边缘）
   * @returns {number} 归一化增益值 [0, 1]，0代表静音，1代表满音量
   */
  static calculateDistanceGain(pX, pY, cX, cY, maxAllowedRadius) {
    const dx = pX - cX;
    const dy = pY - cY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    let gain = Math.max(0, 1 - (distance / maxAllowedRadius));
    // 采用指数次幂 1.5 对线性衰减进行修正，以符合人类双耳对响度的对数级感知
    return Math.pow(gain, 1.5);
  }

  /**
   * 更新 Web Audio PannerNode 的声场定位参数。
   * 我们将二维平面的 Y 轴移动映射到三维声场的 Z 轴上，
   * 从而使用户在双耳耳机中能够感知到“前后”与“左右”的 360 度纵深声学场景。
   * 
   * @param {PannerNode} pannerNode Web Audio PannerNode 节点
   * @param {number} normX 归一化横坐标 [-1, 1] （控制左右声像 panning）
   * @param {number} normY 归一化纵坐标 [-1, 1] （控制前后深度 panning）
   * @param {AudioContext} audioCtx 当前音频上下文
   * @param {number} spatialScale 声场空间缩放系数（默认使用 4.0）
   */
  static updatePannerPosition(pannerNode, normX, normY, audioCtx, spatialScale = 4.0) {
    if (!pannerNode || !audioCtx) return;
    const now = audioCtx.currentTime;

    const posX = normX * spatialScale;
    const posZ = -normY * spatialScale; // Z轴为前后纵深

    // 使用 AudioParam.setValueAtTime 平滑设定以避免声学咔哒声（click）
    pannerNode.positionX.setValueAtTime(posX, now);
    pannerNode.positionY.setValueAtTime(0, now);
    pannerNode.positionZ.setValueAtTime(posZ, now);
  }
}
