/**
 * CollisionEngine.js
 * 
 * 空间碰撞与声音化学键反应检测算法模块。
 * 本模块负责在渲染循环中实时计算各个气泡之间的欧氏距离，
 * 当距离低于化学键临界阈值时触发反应状态，并基于接近程度输出归一化的化学反应强度参数。
 */

export class CollisionEngine {
  /**
   * 计算两个二维点的欧氏距离（Euclidean Distance）。
   * 公式：
   * d = sqrt((x1 - x2)^2 + (y1 - y2)^2)
   * 
   * @param {number} x1 第一个点的横坐标
   * @param {number} y1 第一个点的纵坐标
   * @param {number} x2 第二个点的横坐标
   * @param {number} y2 第二个点的纵坐标
   * @returns {number} 两点间的欧氏距离
   */
  static getDistance(x1, y1, x2, y2) {
    const dx = x1 - x2;
    const dy = y1 - y2;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * 评估两个元素之间是否发生声音化学反应并输出归一化结合强度。
   * 反应强度强度曲线：
   * Strength = max(0, 1 - d / Threshold)
   * 当两点重合时 Strength = 1.0 (最大结合)，当距离大于等于 Threshold 时 Strength = 0.0 (未反应)。
   * 
   * @param {number} x1 元素 A 横坐标 (px)
   * @param {number} y1 元素 A 纵坐标 (px)
   * @param {number} x2 元素 B 横坐标 (px)
   * @param {number} y2 元素 B 纵坐标 (px)
   * @param {number} threshold 反应触发临界距离 (px)，本项目默认使用 120px
   * @returns {{hasReacted: boolean, strength: number}} 反应状态与结合强度
   */
  static evaluateReaction(x1, y1, x2, y2, threshold = 120) {
    const distance = this.getDistance(x1, y1, x2, y2);
    
    if (distance < threshold) {
      const strength = 1.0 - (distance / threshold);
      return {
        hasReacted: true,
        strength: Math.min(1.0, Math.max(0.0, strength))
      };
    }

    return { hasReacted: false, strength: 0.0 };
  }

  /**
   * 检查是否达成“全共振大融合”状态。
   * 判定规则：房间内所有声音元素与中心 Listener 节点的有效音量均高于设定的基准阈值（即全部靠近中心）。
   * 
   * @param {Object.<string, number>} distancesMap 包含各元素到中心增益衰减的映射表，值范围 [0, 1]
   * @param {number} threshold 能量基准阈值（本项目默认使用 0.45）
   * @returns {boolean} 是否达成完美共鸣
   */
  static evaluatePerfectResonance(distancesMap, threshold = 0.45) {
    const keys = Object.keys(distancesMap);
    if (keys.length === 0) return false;
    
    // 必须满足所有气泡距离中心对应的 Gain 值都大于 threshold
    return keys.every(key => distancesMap[key] > threshold);
  }
}
