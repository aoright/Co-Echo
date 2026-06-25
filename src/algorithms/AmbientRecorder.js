/**
 * AmbientRecorder.js
 * 
 * 外部环境声音采集与 PCM 解码算法模块。
 * 用于录制 4 秒以内的外界有机声音（风声、敲击声等），
 * 并自动解码为 Web Audio API 的 AudioBuffer，注入到合成器的氛围声部中循环演奏。
 */

export class AmbientRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.chunks = [];
    this.stream = null;
  }

  /**
   * 录制环境声音
   * @param {AudioContext} audioCtx 当前音频上下文
   * @param {number} durationMs 录音持续毫秒数
   * @param {Function} onProgress 录音进度回调 (当前剩余秒数)
   * @returns {Promise<AudioBuffer>} 解码后的 PCM 采样数据
   */
  record(audioCtx, durationMs = 4000, onProgress = null) {
    return new Promise((resolve, reject) => {
      this.chunks = [];
      
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          this.stream = stream;
          this.mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
          
          this.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              this.chunks.push(e.data);
            }
          };

          this.mediaRecorder.onstop = () => {
            // 释放音轨硬件占用
            if (this.stream) {
              this.stream.getTracks().forEach(track => track.stop());
            }

            const blob = new Blob(this.chunks, { type: 'audio/webm' });
            blob.arrayBuffer()
              .then(arrayBuffer => audioCtx.decodeAudioData(arrayBuffer))
              .then(audioBuffer => resolve(audioBuffer))
              .catch(err => reject(err));
          };

          this.mediaRecorder.start();

          // 进度与超时定时器
          let timeLeft = Math.ceil(durationMs / 1000);
          if (onProgress) onProgress(timeLeft);

          const intervalId = setInterval(() => {
            timeLeft -= 1;
            if (timeLeft <= 0) {
              clearInterval(intervalId);
            } else if (onProgress) {
              onProgress(timeLeft);
            }
          }, 1000);

          setTimeout(() => {
            clearInterval(intervalId);
            if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
              this.mediaRecorder.stop();
            }
          }, durationMs);
        })
        .catch(err => {
          reject(err);
        });
    });
  }

  /**
   * 强制终止并释放资源
   */
  abort() {
    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.onstop = null;
      this.mediaRecorder.stop();
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
    }
  }
}
