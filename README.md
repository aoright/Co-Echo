# Co-Echo (共鸣回廊)

Co-Echo (共鸣回廊) 是一个多人实时声音化学共创空间与空间音频沙盘交互系统。它旨在打破传统在线音乐社交被动的点歌与收听模式，通过极简的物理沙盘交互，降低大众音乐创作与协同交流的专业门槛。

项目网页 Demo 体验地址：
[https://aoright.github.io/Co-Echo/](https://aoright.github.io/Co-Echo/)

---

## 核心特性

1. **三维空间音频定位 (3D Spatial Audio)**
   * 基于 Web Audio API PannerNode（HRTF 算法模型）开发。
   * 用户将气泡拉向圆心聆听者，音量会随距离按指数衰减；左右移动时，声音在耳机左右声道产生高保真声相偏移。

2. **声音化学合成引擎 (Sonic Chemistry Synthesis)**
   * 将声学成分拆解为 H (氢/节奏)、O (氧/旋律)、N (氮/人声)、C (碳/氛围) 四种基础化学元素。
   * **化学键合反应**：当不同元素的气泡相互靠近（小于120px）时，在 Canvas 表面拉起连接线。氢与氧相遇时触发 AI 生成低音 Bassline 粘合节奏；氮与碳相遇时为低沉人声注入风雨涌动般低频呼吸滤波包络。
   * **全共振大融合**：当四元素汇聚于中心区，触发终极共鸣音效。

3. **物理滑行惯性 (Lerp Drag & Slide)**
   * 基于线性插值（Linear Interpolation）算法实现气泡拖拽阻尼反馈。
   * 当用户松开鼠标或移开手指时，声音气泡会产生一段平滑自然的滑动滑行痕迹，大幅提升交互手感。

4. **空间延迟效果器 (Algorithmic Space Echo)**
   * 在氧元素（琶音）与氮元素（人声）音轨中并联反馈延时网络 (DelayNode & GainNode Feedback Loop)。
   * 使合成的声音产生空灵悠长的立体声回音尾音，大大扩充空间听感。

5. **麦克风人声捕捉 (Microphone Hum Recorder)**
   * 调用浏览器录音权限，捕获最长 3 秒的原始 PCM 音频。
   * 录音结束后实时转化为 AudioBuffer 替换原始合成器音源，让用户的真实人声直接参与空间共创。

6. **全局混音导出 (Master Mix Export)**
   * 采用 `createMediaStreamDestination` 获取混音总线，由 `MediaRecorder` 打包为高保真音频。
   * 用户可一键导出并下载共创生成的 `.webm` 格式原创环境音频。

7. **协作模拟 (Multiplayer Wandering)**
   * 动态模拟多人在线场景。在闲置状态下，其他协作者的气泡会在沙盘中随机游走漂移，自动引发化学共鸣，使沙盘时刻保持动态音乐反应。

---

## 运行与体验方式

由于 Web Audio API 及麦克风录音功能在某些浏览器环境下存在安全沙箱限制（File 协议可能无法使用录音及部分音频节点），**强烈建议使用本地服务器环境运行本原型**：

1. 克隆本项目：
   ```bash
   git clone https://github.com/aoright/Co-Echo.git
   cd Co-Echo
   ```
2. 启动本地静态服务器：
   ```bash
   # 使用 Node.js 的 http-server
   npx -y http-server -p 8088
   
   # 或者使用 Python 3
   python -y -m http.server 8088
   ```
3. 用浏览器打开地址：
   [http://localhost:8088](http://localhost:8088)

---

## 项目演示视频

用户可在本地运行后使用录屏软件（如 OBS 或系统自带录屏）录制一段 1 分钟左右的演示视频，命名为 `demo_video.mp4` 并放置在项目根目录下或将视频上传至 GitHub Repository Release 中，在此处插入视频链接。
