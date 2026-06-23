/**
 * MasterRecorder.js
 * 
 * 混音总线媒体流编码与 WebM 导出算法模块。
 * 本模块负责连接 Web Audio API 的全局输出流，
 * 并将其捕获、实时编码，在结束录制时触发浏览器的二进制 Blob 自动下载。
 */

export class MasterRecorder {
  /**
   * 
   * @param {AudioNode} recordingDestinationNode Web Audio 的 MediaStreamAudioDestinationNode 录音节点
   */
  constructor(recordingDestinationNode) {
    this.destNode = recordingDestinationNode;
    this.mediaRecorder = null;
    this.chunks = [];
    this.isRecording = false;
  }

  /**
   * 开启主总线混音录屏/录音。
   * 
   * 算法核心：
   * 1. 从 MediaStreamAudioDestinationNode 中取出内部关联的 MediaStream 轨道。
   * 2. 使用 Opus 编码器（对于 WebM/audio）初始化 MediaRecorder 容器。
   * 
   * @returns {boolean} 是否启动成功
   */
  start() {
    if (!this.destNode || this.isRecording) return false;
    
    this.chunks = [];
    
    try {
      this.mediaRecorder = new MediaRecorder(this.destNode.stream, {
        mimeType: 'audio/webm;codecs=opus'
      });
    } catch (e) {
      // 降级使用默认编码格式，防范部分浏览器不支持 WebM Opus 容器
      this.mediaRecorder = new MediaRecorder(this.destNode.stream);
    }

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };

    this.mediaRecorder.start();
    this.isRecording = true;
    return true;
  }

  /**
   * 停止混音总线录音，并返回生成的二进制 Blob 供后续下载。
   * 
   * @returns {Promise<Blob>} 录制完成的声音二进制数据包
   */
  stop() {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || !this.isRecording) {
        reject(new Error("录制未启动"));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        this.isRecording = false;
        resolve(blob);
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * 将二进制音频数据封装，触发浏览器无痕文件下载。
   * 
   * @param {Blob} blob 二进制音频块
   * @param {string} filename 导出的文件名
   */
  static triggerDownload(blob, filename = 'co_echo_mix.webm') {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    
    // 延迟销毁临时 URL 以防止部分浏览器提前阻断下载
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }
}
