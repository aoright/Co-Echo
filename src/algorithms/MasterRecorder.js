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
      if (!this.isRecording) return;
      const left = e.inputBuffer.getChannelData(0);
      const right = e.inputBuffer.getChannelData(1);

      // 克隆数据，防止共享内存块被浏览器下一帧重写
      this.leftChannel.push(new Float32Array(left));
      this.rightChannel.push(new Float32Array(right));
      this.recordingLength += left.length;

      // 输出缓冲区默认为静音，防止音频串扰导致音量加倍
    };

    // 路由连接：源节点 -> 录音节点 -> 物理输出（驱动音频拉取线程）
    this.sourceNode.connect(this.scriptNode);
    this.scriptNode.connect(this.audioCtx.destination);

    this.isRecording = true;
    return true;
  }

  /**
   * 停止采集并触发 WAV 报头包装逻辑。
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

      // 断开音频图连接，释放内存
      this.sourceNode.disconnect(this.scriptNode);
      this.scriptNode.disconnect(this.audioCtx.destination);
      this.scriptNode = null;

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
   * 触发浏览器文件下载。
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
