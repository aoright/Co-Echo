/**
 * MicRecorder.js
 * 
 * 麦克风音频流捕获与 PCM 数据重映射算法模块。
 * 本模块使用 MediaRecorder API 捕获用户的声音（哼唱、人声），
 * 并通过异步 Promise 架构封装，在数据捕获完毕后转化为 PCM 采样数组以供 Web Audio API 重新装载。
 */

export class MicRecorder {
  constructor() {
    this.mediaRecorder = null;
    this.chunks = [];
    this.stream = null;
  }

  /**
   * 启动麦克风录音进程。
   * 
   * @returns {Promise<void>} 启动成功的 Promise
   */
  start() {
    return new Promise((resolve, reject) => {
      this.chunks = [];
      navigator.mediaDevices.getUserMedia({ audio: true })
        .then(stream => {
          this.stream = stream;
          this.mediaRecorder = new MediaRecorder(stream);
          
          this.mediaRecorder.ondataavailable = (e) => {
            if (e.data && e.data.size > 0) {
              this.chunks.push(e.data);
            }
          };

          this.mediaRecorder.start();
          resolve();
        })
        .catch(err => {
          reject(err);
        });
    });
  }

  /**
   * 停止录音并将捕获的媒体流转码为 Web Audio 格式的 AudioBuffer。
   * 
   * 算法核心流程：
   * 1. 停止 MediaRecorder 并关闭麦克风硬件通路（release stream tracks）。
   * 2. 将录制的数据分片（chunks）拼装为完整的 WebM/Ogg 容器 Blob。
   * 3. 利用 blob.arrayBuffer() 将数据转入原生内存数组。
   * 4. 驱动 AudioContext.decodeAudioData 执行硬件加速转码，输出 PCM 采样率对应的 AudioBuffer。
   * 
   * @param {AudioContext} audioCtx 当前音频上下文
   * @returns {Promise<AudioBuffer>} 解码成功后的 PCM AudioBuffer 缓冲
   */
  stop(audioCtx) {
    return new Promise((resolve, reject) => {
      if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {
        reject(new Error("录音未启动"));
        return;
      }

      this.mediaRecorder.onstop = () => {
        const blob = new Blob(this.chunks, { type: 'audio/webm' });
        
        // 关闭流中的所有音轨以释放硬件占用
        if (this.stream) {
          this.stream.getTracks().forEach(track => track.stop());
        }

        // 解码音频
        blob.arrayBuffer()
          .then(arrayBuffer => audioCtx.decodeAudioData(arrayBuffer))
          .then(audioBuffer => {
            resolve(audioBuffer);
          })
          .catch(err => {
            reject(err);
          });
      };

      this.mediaRecorder.stop();
    });
  }

  /**
   * 强制终止并释放麦克风设备（用于异常退出或重置）
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
