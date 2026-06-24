/**
 * MasterRecorder.js
 * 
 * 混音总线 PCM 音频捕获与标准 WAV 容器格式化编码模块。
 * 本模块弃用受浏览器兼容性限制较大的 MediaRecorder WebM 压缩，
 * 采用低延迟的 ScriptProcessorNode 双声道 PCM 实时采集技术，
 * 并在录音结束时，于前端动态拼装标准 RIFF-WAVE (16-bit Stereo) 报头，
 * 确保导出的 .wav 音频文件能在各种平台及系统默认播放器中原生完美解码播放。
 */

export class MasterRecorder {
  /**
   * 
   * @param {AudioNode} sourceNode Web Audio API 声音源节点（推荐使用全局 AnalyserNode）
   */
  constructor(sourceNode) {
    this.sourceNode = sourceNode;
    this.audioCtx = sourceNode.context;
    this.scriptNode = null;
    this.leftChannel = [];
    this.rightChannel = [];
    this.recordingLength = 0;
    this.isRecording = false;
  }

  /**
   * 开启混音总线 PCM 采集。
   * 采用桥接模式：断开 sourceNode -> destination，
   * 串联 sourceNode -> scriptNode -> destination。
   * 并将输入 PCM 数据拷贝至输出，从而保持网页发声并维持 onaudioprocess 的活跃触发。
   * 
   * @returns {boolean} 是否启动成功
   */
  start() {
    if (!this.sourceNode || this.isRecording) return false;

    this.leftChannel = [];
    this.rightChannel = [];
    this.recordingLength = 0;

    const bufferSize = 4096;
    // 创建双声道输入、双声道输出的音频处理节点
    this.scriptNode = this.audioCtx.createScriptProcessor(bufferSize, 2, 2);

    this.scriptNode.onaudioprocess = (e) => {
      const left = e.inputBuffer.getChannelData(0);
      const right = e.inputBuffer.getChannelData(1);

      if (this.isRecording) {
        // 克隆数据，防止共享内存块被浏览器下一帧重写
        this.leftChannel.push(new Float32Array(left));
        this.rightChannel.push(new Float32Array(right));
        this.recordingLength += left.length;
      }

      // 将输入数据拷贝到输出数据，以保持音频直通播放，同时激活并维持 onaudioprocess 触发
      const outputL = e.outputBuffer.getChannelData(0);
      const outputR = e.outputBuffer.getChannelData(1);
      outputL.set(left);
      outputR.set(right);
    };

    // 调整路由拓扑：
    // 1. 断开源节点直接输出到扬声器的物理连接，防范某些浏览器下直接输出与桥接输出叠加导致的声音变大
    try {
      this.sourceNode.disconnect(this.audioCtx.destination);
    } catch (err) {
      // 容错：全断开
      try {
        this.sourceNode.disconnect();
      } catch (innerErr) {
        console.warn("sourceNode disconnect failed:", innerErr);
      }
    }

    // 2. 将录制节点作为桥接器串接在中间：源节点 -> 录制节点 -> 扬声器
    this.sourceNode.connect(this.scriptNode);
    this.scriptNode.connect(this.audioCtx.destination);

    this.isRecording = true;
    return true;
  }

  /**
   * 停止采集并触发 WAV 报头包装逻辑。
   * 还原路由拓扑：断开 scriptNode，将 sourceNode 直接重新连接至 destination，恢复网页声音。
   * 
   * @returns {Promise<Blob>} 标准 WAV 音频 Blob 数据
   */
  stop() {
    return new Promise((resolve, reject) => {
      if (!this.scriptNode || !this.isRecording) {
        reject(new Error("录制未启动"));
        return;
      }

      this.isRecording = false;

      // 还原路由拓扑：
      // 1. 断开桥接连接
      try {
        this.sourceNode.disconnect(this.scriptNode);
      } catch (err) {
        try {
          this.sourceNode.disconnect();
        } catch (innerErr) {
          console.warn("sourceNode disconnect failed in stop:", innerErr);
        }
      }
      try {
        this.scriptNode.disconnect(this.audioCtx.destination);
      } catch (err) {
        console.warn("scriptNode disconnect failed:", err);
      }
      this.scriptNode = null;

      // 2. 重新将源节点连接至扬声器，恢复网页直接播放声音
      this.sourceNode.connect(this.audioCtx.destination);

      // 合并分段音频帧
      const leftBuffer = this.mergeBuffers(this.leftChannel, this.recordingLength);
      const rightBuffer = this.mergeBuffers(this.rightChannel, this.recordingLength);

      // 交织双声道 PCM 数据
      const interleaved = this.interleave(leftBuffer, rightBuffer);

      // 组装 RIFF WAVE 文件
      const buffer = new ArrayBuffer(44 + interleaved.length * 2);
      const view = new DataView(buffer);
      const sampleRate = this.audioCtx.sampleRate;

      // RIFF 标头
      this.writeString(view, 0, 'RIFF');
      // 文件总字节数（报头 36 字节 + 数据字节数）
      view.setUint32(4, 36 + interleaved.length * 2, true);
      // WAVE 标识
      this.writeString(view, 8, 'WAVE');
      // fmt 子块标头
      this.writeString(view, 12, 'fmt ');
      // 子块大小 (16字节)
      view.setUint32(16, 16, true);
      // 编码格式 (1 代表未压缩的 PCM)
      view.setUint16(20, 1, true);
      // 声道数 (2 代表 Stereo 双声道)
      view.setUint16(22, 2, true);
      // 采样率
      view.setUint32(24, sampleRate, true);
      // 传输速率 (采样率 * 双声道 * 2字节)
      view.setUint32(28, sampleRate * 4, true);
      // 数据块对齐 (声道数 * 2字节)
      view.setUint16(32, 4, true);
      // 量化精度 (16-bit)
      view.setUint16(34, 16, true);
      // data 数据子块标头
      this.writeString(view, 36, 'data');
      // 音频 PCM 数据总长度
      view.setUint32(40, interleaved.length * 2, true);

      // 写入 16-bit 线性 PCM 音频数据
      this.floatTo16BitPCM(view, 44, interleaved);

      const blob = new Blob([view], { type: 'audio/wav' });
      resolve(blob);
    });
  }

  mergeBuffers(channelBuffer, recordingLength) {
    const result = new Float32Array(recordingLength);
    let offset = 0;
    for (let i = 0; i < channelBuffer.length; i++) {
      const buffer = channelBuffer[i];
      result.set(buffer, offset);
      offset += buffer.length;
    }
    return result;
  }

  interleave(inputL, inputR) {
    const length = inputL.length + inputR.length;
    const result = new Float32Array(length);
    let index = 0;
    let inputIndex = 0;
    while (index < length) {
      result[index++] = inputL[inputIndex];
      result[index++] = inputR[inputIndex];
      inputIndex++;
    }
    return result;
  }

  floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, input[i]));
      output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
  }

  writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  /**
   * 触发浏览器 file 下载。
   * 
   * @param {Blob} blob WAV 音频数据 Blob
   * @param {string} filename 保存的文件名
   */
  static triggerDownload(blob, filename = 'co_echo_mix.wav') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }
}
