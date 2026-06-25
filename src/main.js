import { SoundEngine } from './core/SoundEngine.js';
import { PhysicsLerp } from './algorithms/PhysicsLerp.js';
import { CollisionEngine } from './algorithms/CollisionEngine.js';
import { MasterRecorder } from './algorithms/MasterRecorder.js';
import { AmbientRecorder } from './algorithms/AmbientRecorder.js';
import { Visualizer } from './ui/Visualizer.js';
import { CanvasRenderer } from './ui/CanvasRenderer.js';
import { SpatialAudio } from './algorithms/SpatialAudio.js';

document.addEventListener('DOMContentLoaded', () => {
  const engine = new SoundEngine();
  const ambientRecorder = new AmbientRecorder();
  let masterRecorder = null;

  // DOM 节点获取
  const btnToggleAudio = document.getElementById('btn-toggle-audio');
  const btnText = document.getElementById('btn-text');
  const btnExportRecording = document.getElementById('btn-export-recording');
  const btnExportText = document.getElementById('btn-export-text');
  
  // 环境音录音与预设节点获取
  const btnRecordAmbient = document.getElementById('btn-record-ambient');
  const btnAmbientText = document.getElementById('btn-ambient-text');
  const selectBeatPreset = document.getElementById('select-beat-preset');
  const selectMelodyPreset = document.getElementById('select-melody-preset');
  const selectChordPreset = document.getElementById('select-chord-preset');
  const selectAmbientPreset = document.getElementById('select-ambient-preset');

  // AI 节点获取
  const aiPromptInput = document.getElementById('ai-prompt-input');
  const aiKeyInput = document.getElementById('ai-key-input');
  const btnAiTune = document.getElementById('btn-ai-tune');
  const btnAiText = document.getElementById('btn-ai-text');
  
  const roomStatusText = document.getElementById('room-status-text');
  const statusDot = document.querySelector('.status-dot');
  const recordingBadge = document.getElementById('recording-badge');
  const sliderBpm = document.getElementById('slider-bpm');
  const valBpm = document.getElementById('val-bpm');
  const selectScale = document.getElementById('select-scale');
  const logContainer = document.getElementById('log-container');
  const sandbox = document.getElementById('sandbox');
  const canvas = document.getElementById('connection-canvas');

  // UI 渲染类实例化
  const renderer = new CanvasRenderer(canvas);
  const visualizer = new Visualizer(document.querySelectorAll('.visualizer-bars .bar'));

  // 气泡气动参数与初始位置记录 (百分比)
  const bubblePhysics = {
    beat: { currentX: 20, currentY: 25, targetX: 20, targetY: 25, baseX: 20, baseY: 25, dragging: false },
    melody: { currentX: 80, currentY: 30, targetX: 80, targetY: 30, baseX: 80, baseY: 30, dragging: false },
    voice: { currentX: 30, currentY: 75, targetX: 30, targetY: 75, baseX: 30, baseY: 75, dragging: false },
    ambient: { currentX: 70, currentY: 70, targetX: 70, targetY: 70, baseX: 70, baseY: 70, dragging: false }
  };

  const elements = {
    beat: document.getElementById('el-beat'),
    melody: document.getElementById('el-melody'),
    voice: document.getElementById('el-voice'),
    ambient: document.getElementById('el-ambient')
  };

  let dragKey = null;
  let sandboxRect = null;
  let sandboxRadius = 0;

  const reactionStatus = {
    beatMelody: false,
    voiceAmbient: false,
    allFour: false
  };

  // 纯音乐合成：不涉及麦克风与人声合成

  // 初始化 Canvas 尺寸
  function resize() {
    sandboxRect = sandbox.getBoundingClientRect();
    sandboxRadius = sandboxRect.width / 2;
    canvas.width = sandboxRect.width;
    canvas.height = sandboxRect.height;
  }
  resize();
  window.addEventListener('resize', resize);

  btnToggleAudio.addEventListener('click', () => {
    if (!engine.isPlaying) {
      try {
        // 在激活引擎时强制重新计算沙盘尺寸，防止页面初次加载布局尚未完成时尺寸获取为 0 的问题
        resize();
        engine.init();
        engine.bpm = parseInt(sliderBpm.value);
        engine.currentScale = selectScale.value;
        
        // 绑定主总线录音器，传入 analyser 节点以捕获完整的音频数据流
        masterRecorder = new MasterRecorder(engine.analyser);

        btnToggleAudio.classList.remove('btn-primary');
        btnToggleAudio.classList.add('btn-stop');
        btnText.textContent = "暂停共鸣空间";
        
        roomStatusText.textContent = "声音共创中";
        statusDot.classList.remove('pulsing');
        statusDot.classList.add('active');
        
        sliderBpm.removeAttribute('disabled');
        selectScale.removeAttribute('disabled');
        btnExportRecording.removeAttribute('disabled');
        btnRecordAmbient.removeAttribute('disabled');
        selectBeatPreset.removeAttribute('disabled');
        selectMelodyPreset.removeAttribute('disabled');
        selectChordPreset.removeAttribute('disabled');
        selectAmbientPreset.removeAttribute('disabled');
        aiPromptInput.removeAttribute('disabled');
        aiKeyInput.removeAttribute('disabled');
        btnAiTune.removeAttribute('disabled');
        
        addLog("[系统] 共鸣空间已激活。Web Audio 合成引擎已就绪。", "system");
        
        Object.values(elements).forEach(el => el.classList.add('active'));
        
        requestAnimationFrame(updateFrame);
      } catch (err) {
        addLog(`[系统错误] 音频启动失败: ${err.message}`, "system");
        console.error(err);
      }
    } else {
      // 停止运行中录音
      if (masterRecorder && masterRecorder.isRecording) {
        stopMasterRecordingHelper();
      }


      engine.close();
      masterRecorder = null;
      
      btnToggleAudio.classList.remove('btn-stop');
      btnToggleAudio.classList.add('btn-primary');
      btnText.textContent = "激活共鸣空间";
      
      roomStatusText.textContent = "待激活实验室";
      statusDot.classList.remove('active');
      statusDot.classList.add('pulsing');
      
      sliderBpm.setAttribute('disabled', 'true');
      selectScale.setAttribute('disabled', 'true');
      btnExportRecording.setAttribute('disabled', 'true');
      btnRecordAmbient.setAttribute('disabled', 'true');
      selectBeatPreset.setAttribute('disabled', 'true');
      selectMelodyPreset.setAttribute('disabled', 'true');
      selectChordPreset.setAttribute('disabled', 'true');
      selectAmbientPreset.setAttribute('disabled', 'true');
      aiPromptInput.setAttribute('disabled', 'true');
      aiKeyInput.setAttribute('disabled', 'true');
      btnAiTune.setAttribute('disabled', 'true');
      
      addLog("[系统] 共鸣空间已暂停。声音流已释放。", "system");
      
      Object.values(elements).forEach(el => el.classList.remove('active'));
      renderer.clear();
    }
  });

  // 新增：AI 声音调剂控制 (Alibaba Cloud Qwen-Plus Integration)
  btnAiTune.addEventListener('click', () => {
    if (!engine.isPlaying) return;
    
    const prompt = aiPromptInput.value.trim();
    const apiKey = aiKeyInput.value.trim();
    
    if (!prompt) {
      addLog("[AI调剂] 请先输入你想表达的听觉场景或心情状态。", "system");
      return;
    }
    
    if (!apiKey) {
      addLog("[AI调剂] 请填写有效的百炼 API Key 密钥。", "system");
      return;
    }
    
    btnAiTune.setAttribute('disabled', 'true');
    btnAiText.textContent = "AI 调配中...";
    addLog("[AI调剂] 正在呼唤 Qwen-Plus 声音化学家调剂音景...", "system");
    
    fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        messages: [
          {
            role: 'system',
            content: '你是一个声音化学调剂师。请根据用户描述的情绪或场景，返回一个描述听觉感受的 JSON 对象。不能包含任何 markdown 标记（如 ```json 等），只返回纯文本 JSON。\n\nJSON 格式规范：\n{\n  "bpm": 60到150之间的整数,\n  "scale": "major-pentatonic" 或 "minor-pentatonic" 或 "lydian" 或 "dorian",\n  "positions": {\n    "beat": {"x": 15到85的整数, "y": 15到85的整数},\n    "melody": {"x": 15到85的整数, "y": 15到85的整数},\n    "voice": {"x": 15到85的整数, "y": 15到85的整数},\n    "ambient": {"x": 15到85的整数, "y": 15到85的整数}\n  },\n  "poem": "用不超过30字描述该情绪的治愈诗句"\n}'
          },
          {
            role: 'user',
            content: `用户的场景描述为：${prompt}`
          }
        ],
        response_format: { type: 'json_object' }
      })
    })
    .then(response => {
      if (!response.ok) {
        throw new Error(`HTTP 异常状态 ${response.status}`);
      }
      return response.json();
    })
    .then(res => {
      const rawText = res.choices[0].message.content.trim();
      let data;
      try {
        data = JSON.parse(rawText);
      } catch (e) {
        const cleanedText = rawText.replace(/```json/g, '').replace(/```/g, '').trim();
        data = JSON.parse(cleanedText);
      }
      
      // 更新系统参数
      if (data.bpm) {
        sliderBpm.value = data.bpm;
        valBpm.textContent = data.bpm;
        engine.bpm = data.bpm;
      }
      if (data.scale) {
        selectScale.value = data.scale;
        engine.currentScale = data.scale;
      }
      
      // 更新气泡 target 位置，自动触发滑行动画
      if (data.positions) {
        Object.entries(data.positions).forEach(([key, pos]) => {
          if (bubblePhysics[key]) {
            bubblePhysics[key].targetX = pos.x;
            bubblePhysics[key].targetY = pos.y;
            bubblePhysics[key].baseX = pos.x;
            bubblePhysics[key].baseY = pos.y;
          }
        });
      }
      
      addLog(`[AI诗句] "${data.poem}"`, "chemical");
      addLog("[AI调剂] 声场调谐完毕，情绪治愈短诗已生成。", "interaction");

      btnAiTune.removeAttribute('disabled');
      btnAiText.textContent = "智能调谐声场";
    })
    .catch(err => {
      addLog(`[AI调剂失败] ${err.message}`, "system");
      btnAiTune.removeAttribute('disabled');
      btnAiText.textContent = "智能调谐声场";
    });
  });

  // 2. 乐音预设与环境音采集控制
  selectBeatPreset.addEventListener('change', (e) => {
    engine.activePresets.beat = e.target.value;
    addLog(`[预设变更] 氢(BEAT) 节奏模式已切换为: ${selectBeatPreset.options[selectBeatPreset.selectedIndex].text}`, "interaction");
  });

  selectMelodyPreset.addEventListener('change', (e) => {
    engine.activePresets.melody = e.target.value;
    addLog(`[预设变更] 氧(MELODY) 旋律模式已切换为: ${selectMelodyPreset.options[selectMelodyPreset.selectedIndex].text}`, "interaction");
  });

  selectChordPreset.addEventListener('change', (e) => {
    engine.activePresets.chord = e.target.value;
    addLog(`[预设变更] 氮(CHORD) 和弦模式已切换为: ${selectChordPreset.options[selectChordPreset.selectedIndex].text}`, "interaction");
  });

  selectAmbientPreset.addEventListener('change', (e) => {
    engine.updateAmbientPreset(e.target.value);
    addLog(`[预设变更] 碳(AMBIENT) 氛围模式已切换为: ${selectAmbientPreset.options[selectAmbientPreset.selectedIndex].text}`, "interaction");
  });

  let isRecordingAmbient = false;
  btnRecordAmbient.addEventListener('click', () => {
    if (!engine.isPlaying) return;

    if (!isRecordingAmbient) {
      isRecordingAmbient = true;
      btnRecordAmbient.classList.remove('btn-secondary');
      btnRecordAmbient.classList.add('btn-recording');
      btnAmbientText.textContent = "录制中...";
      addLog("[外界采集] 麦克风已启动，请对着麦克风发出声音（限时4秒）...", "system");

      ambientRecorder.record(engine.audioCtx, 4000, (timeLeft) => {
        btnAmbientText.textContent = `录制中 (${timeLeft}s)...`;
      })
      .then(audioBuffer => {
        engine.loadCustomAmbientBuffer(audioBuffer);
        selectAmbientPreset.value = 'recorded';
        engine.activePresets.ambient = 'recorded';
        addLog("[外界采集] 环境声采集完毕，已将其循环融合入碳(AMBIENT)氛围声部。", "interaction");
        resetAmbientUI();
      })
      .catch(err => {
        addLog(`[采集失败] 环境音录制出错: ${err.message}`, "system");
        resetAmbientUI();
      });
    } else {
      ambientRecorder.abort();
      resetAmbientUI();
    }
  });

  function resetAmbientUI() {
    isRecordingAmbient = false;
    btnRecordAmbient.classList.remove('btn-recording');
    btnRecordAmbient.classList.add('btn-secondary');
    btnAmbientText.textContent = "采集外界环境声";
  }

  // 键盘乐器按键监听 (A-S-D-F-G-H-J-K)
  const keysList = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK'];
  window.addEventListener('keydown', (e) => {
    if (!engine.isPlaying) return;
    
    // 如果焦点在输入框中，忽略键盘发声
    if (document.activeElement.tagName === 'TEXTAREA' || document.activeElement.tagName === 'INPUT') {
      return;
    }

    const code = e.code;
    if (keysList.includes(code)) {
      e.preventDefault();
      const pitchIndex = keysList.indexOf(code);
      engine.playManualNote(pitchIndex);

      // 在中心 Listener 位置渲染冲击波
      sandboxRect = sandbox.getBoundingClientRect();
      const cX = sandboxRect.width / 2;
      const cY = sandboxRect.height / 2;
      renderer.addRipple(cX, cY, 'rgba(17, 17, 17, 0.4)', 160);

      addLog(`[键盘演奏] 弹奏音阶级数: ${pitchIndex + 1}`, "interaction");
    }
  });

  // 沙盘空白处点击涟漪与实时发音
  sandbox.addEventListener('mousedown', (e) => {
    if (!engine.isPlaying) return;
    if (dragKey) return; // 如果正在拖拽气泡，不触发点击弹奏

    // 如果点击的是气泡或中心监听者，则不触发
    if (e.target.closest('.element') || e.target.closest('.listener-node')) {
      return;
    }

    sandboxRect = sandbox.getBoundingClientRect();
    const clickX = e.clientX - sandboxRect.left;
    const clickY = e.clientY - sandboxRect.top;

    const cX = sandboxRect.width / 2;
    const cY = sandboxRect.height / 2;

    engine.playClickNote(clickX, clickY, cX, cY, sandboxRadius);
    renderer.addRipple(clickX, clickY, 'rgba(17, 17, 17, 0.3)', 120);

    addLog("[沙盘共鸣] 空白空间受击，激发一次 3D 偏置弹奏音符。", "interaction");
  });

  // 3. 作品录音与导出控制
  btnExportRecording.addEventListener('click', () => {
    if (!engine.isPlaying || !masterRecorder) return;

    if (!masterRecorder.isRecording) {
      if (masterRecorder.start()) {
        btnExportRecording.classList.remove('btn-secondary');
        btnExportRecording.classList.add('btn-recording');
        btnExportText.textContent = "停止并导出作品";
        recordingBadge.classList.remove('hidden');
        addLog("[作品录制] 开始录制当前共鸣空间的所有音轨混音。", "system");
      }
    } else {
      stopMasterRecordingHelper();
    }
  });

  function stopMasterRecordingHelper() {
    masterRecorder.stop()
      .then(blob => {
        MasterRecorder.triggerDownload(blob, 'Co-Echo_声音化学作品.wav');
        btnExportRecording.classList.remove('btn-recording');
        btnExportRecording.classList.add('btn-secondary');
        btnExportText.textContent = "开始录制作品";
        recordingBadge.classList.add('hidden');
        addLog("[作品录制] 录音已结束，文件开始导出下载。", "system");
      })
      .catch(err => {
        console.error(err);
        addLog(`[导出录音失败] ${err.message}`, "system");
      });
  }

  // 4. 参数调整
  sliderBpm.addEventListener('input', (e) => {
    const val = e.target.value;
    valBpm.textContent = val;
    engine.bpm = parseInt(val);
  });

  selectScale.addEventListener('change', (e) => {
    const val = e.target.value;
    engine.currentScale = val;
    const scaleName = selectScale.options[selectScale.selectedIndex].text;
    addLog(`[音阶调整] 当前房间重映射为: ${scaleName}`, "interaction");
  });

  // 5. 拖拽管理
  Object.entries(elements).forEach(([key, el]) => {
    el.addEventListener('mousedown', (e) => startDrag(e, key));
    el.addEventListener('touchstart', (e) => startDrag(e, key), { passive: false });
  });

  function startDrag(e, key) {
    if (!engine.isPlaying) {
      addLog("[提示] 请先激活音频空间，再移动声音气泡。", "system");
      return;
    }
    e.preventDefault();
    dragKey = key;
    bubblePhysics[key].dragging = true;

    document.addEventListener('mousemove', dragMove);
    document.addEventListener('touchmove', dragMove, { passive: false });
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('touchend', stopDrag);
  }

  function dragMove(e) {
    if (!dragKey) return;
    // 阻止移动端的默认滑动行为（如页面滚动）
    e.preventDefault();

    let clientX, clientY;
    // 安全检测 touches 和 changedTouches，防止在某些多端/混合设备上因 touches 列表为空导致 TypeError
    if (e.touches && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if (e.changedTouches && e.changedTouches.length > 0) {
      clientX = e.changedTouches[0].clientX;
      clientY = e.changedTouches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    sandboxRect = sandbox.getBoundingClientRect();
    sandboxRadius = sandboxRect.width / 2;
    
    const centerX = sandboxRect.left + sandboxRadius;
    const centerY = sandboxRect.top + sandboxRadius;
    
    const maxAllowedRadius = sandboxRadius - 36;
    
    // 调用 PhysicsLerp 进行圆形声场裁剪
    const clamped = PhysicsLerp.clampToCircle(
      clientX, 
      clientY, 
      centerX, 
      centerY, 
      maxAllowedRadius
    );
    
    // 转为百分比写入 target
    const percentX = ((clamped.x - sandboxRect.left) / sandboxRect.width) * 100;
    const percentY = ((clamped.y - sandboxRect.top) / sandboxRect.height) * 100;
    
    bubblePhysics[dragKey].targetX = percentX;
    bubblePhysics[dragKey].targetY = percentY;
  }

  function stopDrag() {
    if (dragKey) {
      bubblePhysics[dragKey].dragging = false;
      bubblePhysics[dragKey].baseX = bubblePhysics[dragKey].targetX;
      bubblePhysics[dragKey].baseY = bubblePhysics[dragKey].targetY;
    }
    dragKey = null;
    document.removeEventListener('mousemove', dragMove);
    document.removeEventListener('touchmove', dragMove);
    document.removeEventListener('mouseup', stopDrag);
    document.removeEventListener('touchend', stopDrag);
  }

  // 6. 协同模拟漂移
  function simulateMultiplayer(timestamp) {
    const timeScale = timestamp * 0.0005;
    
    if (!bubblePhysics.beat.dragging && dragKey !== 'beat') {
      const beatOffsetScale = 6;
      const base = bubblePhysics.beat;
      base.targetX = base.baseX + Math.sin(timeScale) * beatOffsetScale;
      base.targetY = base.baseY + Math.cos(timeScale * 0.8) * beatOffsetScale;
    }

    if (!bubblePhysics.ambient.dragging && dragKey !== 'ambient') {
      const ambOffsetScale = 8;
      const base = bubblePhysics.ambient;
      base.targetX = base.baseX + Math.cos(timeScale * 0.6 + 1.2) * ambOffsetScale;
      base.targetY = base.baseY + Math.sin(timeScale * 0.7) * ambOffsetScale;
    }
  }

  // 7. 渲染与物理主循环
  function updateFrame(timestamp) {
    if (!engine.isPlaying) return;

    renderer.clear();
    simulateMultiplayer(timestamp);
    renderer.drawRipples();

    const cX = canvas.width / 2;
    const cY = canvas.height / 2;
    const coords = {};
    const distances = {};
    
    const maxAllowedRadius = sandboxRadius - 36;
    const warningThreshold = maxAllowedRadius * 0.82;
    let isAnyBubbleNearBoundary = false;

    // A. 遍历进行物理 Lerp 滑行更新
    Object.entries(elements).forEach(([key, el]) => {
      const phys = bubblePhysics[key];
      
      // 调用 PhysicsLerp 进行一阶平滑滑行算法
      phys.currentX = PhysicsLerp.lerp(phys.currentX, phys.targetX, 0.12);
      phys.currentY = PhysicsLerp.lerp(phys.currentY, phys.targetY, 0.12);

      el.style.left = `${phys.currentX}%`;
      el.style.top = `${phys.currentY}%`;

      const pX = (phys.currentX / 100) * canvas.width;
      const pY = (phys.currentY / 100) * canvas.height;
      coords[key] = { x: pX, y: pY };

      // B. 声音空间化计算
      const norm = SpatialAudio.normalizeCoordinates(pX, pY, cX, cY, sandboxRadius);
      const gain = SpatialAudio.calculateDistanceGain(pX, pY, cX, cY, maxAllowedRadius);
      distances[key] = gain;

      // 更新声音路由
      engine.updateTrackSpatial(key, norm.x, norm.y, gain);

      // C. 绘制监听指示虚线
      renderer.drawListenerLink(pX, pY, cX, cY, gain);

      // 边缘界限判断
      const dist = CollisionEngine.getDistance(pX, pY, cX, cY);
      if (dist > warningThreshold) {
        isAnyBubbleNearBoundary = true;
      }
    });

    // 绘制边界警告圈
    if (isAnyBubbleNearBoundary) {
      renderer.drawBoundaryWarning(cX, cY, maxAllowedRadius);
    }

    // D. 碰撞与化学反应检测
    const reactionThreshold = 120;
    
    // 反应 1：H + O (Beat + Melody)
    const resBeatMelody = CollisionEngine.evaluateReaction(
      coords.beat.x, coords.beat.y, 
      coords.melody.x, coords.melody.y, 
      reactionThreshold
    );
    if (resBeatMelody.hasReacted) {
      renderer.drawChemicalBond(coords.beat.x, coords.beat.y, coords.melody.x, coords.melody.y, '#111111', 1.5);
      engine.setBassActive(true, resBeatMelody.strength);

      if (!reactionStatus.beatMelody) {
        addLog("[化学反应] H(氢) + O(氧) 形成《律动分子》，AI 已激活重低音 Bass 轨。", "chemical");
        reactionStatus.beatMelody = true;
      }
    } else {
      if (reactionStatus.beatMelody) {
        engine.setBassActive(false);
        addLog("[化学解离] 《律动分子》解离，AI Bass 伴奏已退出。", "system");
        reactionStatus.beatMelody = false;
      }
    }

    // 反应 2：N + C (Voice + Ambient)
    const resVoiceAmbient = CollisionEngine.evaluateReaction(
      coords.voice.x, coords.voice.y, 
      coords.ambient.x, coords.ambient.y, 
      reactionThreshold
    );
    if (resVoiceAmbient.hasReacted) {
      renderer.drawChemicalBond(coords.voice.x, coords.voice.y, coords.ambient.x, coords.ambient.y, '#555555', 1.2);
      engine.setVocalModulation(true);

      if (!reactionStatus.voiceAmbient) {
        addLog("[化学反应] N(氮) + C(碳) 形成《冥想空间》，氛围音轨进入低频滤波振荡。", "chemical");
        reactionStatus.voiceAmbient = true;
      }
    } else {
      if (reactionStatus.voiceAmbient) {
        engine.setVocalModulation(false);
        addLog("[化学解离] 《冥想空间》解离，环境音轨恢复常态。", "system");
        reactionStatus.voiceAmbient = false;
      }
    }

    // 完美共鸣检测
    const isPerfect = CollisionEngine.evaluatePerfectResonance(distances, 0.45);
    if (isPerfect) {
      renderer.drawPerfectResonanceRing(cX, cY, sandboxRadius - 15);
      if (!reactionStatus.allFour) {
        addLog("[完美共鸣] H + O + N + C 发生融合。四重声部达成均衡，共鸣效果完全开启。", "chemical");
        reactionStatus.allFour = true;
      }
    } else {
      reactionStatus.allFour = false;
    }

    // E. 频谱刷新
    visualizer.update(engine.analyser);

    requestAnimationFrame(updateFrame);
  }

  function addLog(text, type = 'system') {
    const item = document.createElement('div');
    item.className = `log-item ${type}`;
    item.textContent = text;
    logContainer.appendChild(item);
    
    logContainer.scrollTop = logContainer.scrollHeight;
    
    if (logContainer.childNodes.length > 25) {
      logContainer.removeChild(logContainer.firstChild);
    }
  }
});
