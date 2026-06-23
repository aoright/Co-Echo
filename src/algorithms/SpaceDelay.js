/**
 * SpaceDelay.js
 * 
 * 反馈延时网络（Feedback Delay Network, FDN）与回声效果器算法模块。
 * 本模块使用 Web Audio 原生 DelayNode 和 GainNode 级联构成单环路反馈延迟器，
 * 为旋律和人声信号提供空间维度上的混响和立体声延迟效果。
 */

export class SpaceDelay {
  /**
   * 构建并级联反馈延迟网络。
   * 
   * 信号流拓扑：
   * Input Source ----+-------------------------> Output Panner
   *                  |                               ^
   *                  v                               |
   *              [DelayNode] ---> [FeedbackGain] ----+
   *                  ^                  |
   *                  |                  v
   *                  +------------------+
   * 
   * 离散时间公式：
   * y(n) = x(n) + g * y(n - D)
   * 其中 x(n) 是输入信号，y(n) 是输出信号，D 为延迟采样点数（由 delayTime.value 决定），
   * g 为反馈增益系数（由 feedbackGain.gain.value 决定）。
   * 
   * @param {AudioContext} audioCtx 当前音频上下文
   * @param {AudioNode} inputNode 输入源连接点（如 PannerNode）
   * @param {AudioNode} outputNode 最终输出连接点（如 TrackMaster GainNode）
   * @param {number} delayTime 延迟时间值 (s)，默认为 0.35s
   * @param {number} feedbackGain 反馈衰减增益量，范围 [0, 1)，默认为 0.4
   * @returns {{delayNode: DelayNode, feedbackNode: GainNode}} 效果器节点元组
   */
  static createDelayFeedbackLoop(audioCtx, inputNode, outputNode, delayTime = 0.35, feedbackGain = 0.4) {
    // 实例化最大支持 2 秒的延时节点
    const delayNode = audioCtx.createDelay(2.0);
    delayNode.delayTime.value = delayTime;

    // 实例化反馈回路增益节点
    const feedbackNode = audioCtx.createGain();
    feedbackNode.gain.value = feedbackGain;

    // 建立反馈环路连线
    inputNode.connect(delayNode);
    delayNode.connect(feedbackNode);
    feedbackNode.connect(delayNode); // 闭合反馈环路
    
    // 将干湿声信号混合输出
    feedbackNode.connect(outputNode);

    return { delayNode, feedbackNode };
  }
}
