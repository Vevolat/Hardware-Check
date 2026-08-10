// ================================================================
//  headphone-audio.js — 耳机音乐播放检测（波形 / 音量）
//  依赖：无（DOM 元素由 index.html 提供，音乐文件 music/dukou.flac）
//  导出（全局）：
//    startHeadphoneAudio / stopHeadphoneAudio   — 生命周期（由 headphone-detector 调用）
//    toggleHeadphonePlayback                    — 播放 / 暂停
//    setHeadphoneVolume(v) / getHeadphoneVolume — 音量控制（v: 0..1）
//    toggleHeadphoneMute                        — 静音切换
//
//  音频图（Web Audio API）：
//    <audio> ─MediaElementSource─▶ GainNode(音量) ─▶ AnalyserNode(波形) ─▶ StereoPannerNode(声道平衡) ─▶ destination
//                       └──── ChannelSplitter ─▶ L/R AnalyserNode（声道检测，旁路分流，不影响主输出）
//  注：StereoPannerNode 不可用时回退为直连（声道平衡不可用）。
// ================================================================

const HP_AUDIO_SRC='music/dukou.flac';
const HP_DEFAULT_VOLUME=1.0; // 0..1（默认 100% 最大音量）

// 模块状态
let hpAudioEl=null;          // HTMLAudioElement（音乐源）
let hpAudioCtx=null;         // AudioContext
let hpSourceNode=null;       // MediaElementAudioSourceNode
let hpGainNode=null;         // GainNode —— 音量控制
let hpAnalyser=null;         // AnalyserNode —— 波形采样
let hpWaveData=null;         // Uint8Array 波形缓冲
let hpCanvas=null;           // 波形 canvas
let hpCanvasCtx=null;        // canvas 2d 上下文
let hpWaveRAF=null;          // requestAnimationFrame 句柄
let hpVolume=HP_DEFAULT_VOLUME; // 当前音量（0..1）
let hpPrevVolume=HP_DEFAULT_VOLUME;// 静音前的音量
let hpGraphBuilt=false;      // AudioContext 图是否已构建（MediaElementSource 只能建一次）
let hpResizeHandler=null;    // window resize 监听（仅播放时挂）

// 声道检测 / 平衡
let hpSplitter=null;         // ChannelSplitterNode（声道分流）
let hpLeftAnalyser=null;     // 左声道分析
let hpRightAnalyser=null;    // 右声道分析
let hpLeftData=null;         // 左声道时域缓冲
let hpRightData=null;        // 右声道时域缓冲
let hpPanner=null;           // StereoPannerNode（声道平衡）
let hpBalance=50;            // 声道平衡 0..100（50=居中，0=纯左声道，100=纯右声道）
let hpChannelDetected=false; // 声道检测是否完成
let hpDetectRAF=null;        // 声道检测 RAF 句柄
let hpDetectOkCount=0;       // 连续达标帧计数
let hpEventRegistered=false; // 是否已注册耳机连接事件
const HP_CH_THRESHOLD=0.015;// 声道 RMS 阈值（约振幅均方根）
const HP_CH_OK_FRAMES=3;    // 连续达标帧数（达到即判定双声道正常）

// ----------------------------------------------------------------
//  初始化（进入耳机页面时调用，不自动播放）
// ----------------------------------------------------------------
function startHeadphoneAudio(){
  initAudioElement();
  cacheCanvas();
  registerHeadphoneHooks();   // 注册耳机连接/断开回调（仅一次）
  updateVolumeDisplay();
  updateBalanceDisplay();
  updateBalanceBars();        // L/R 条按默认平衡（居中 50/50）显示
  updateChannelUI();
  updatePlayButton(false);
}

// 创建 / 复用一个 <audio> 元素
function initAudioElement(){
  if(hpAudioEl)return;
  hpAudioEl=new Audio(HP_AUDIO_SRC);
  hpAudioEl.loop=true;          // 循环播放，便于持续检测
  hpAudioEl.preload='metadata'; // 仅拉取元数据（时长）以节省带宽
  // 部分浏览器（如 Safari）要求媒体元素在 DOM 中才能被 MediaElementSource 正确捕获
  hpAudioEl.style.display='none';
  document.body.appendChild(hpAudioEl);
  bindAudioEvents();            // 元素仅创建一次，事件也只需绑一次
}

// 缓存 canvas 与上下文
function cacheCanvas(){
  hpCanvas=document.getElementById('hp-waveform');
  if(hpCanvas)hpCanvasCtx=hpCanvas.getContext('2d');
}

// 绑定 <audio> 事件（仅在元素创建时调用一次）
function bindAudioEvents(){
  if(!hpAudioEl)return;
  hpAudioEl.addEventListener('loadedmetadata',()=>{
    const total=document.getElementById('hp-time-total');
    if(total)total.textContent=formatAudioTime(hpAudioEl.duration);
  });
  hpAudioEl.addEventListener('timeupdate',()=>{
    const cur=document.getElementById('hp-time-current');
    if(cur)cur.textContent=formatAudioTime(hpAudioEl.currentTime);
  });
  hpAudioEl.addEventListener('play',()=>updatePlayButton(true));
  hpAudioEl.addEventListener('pause',()=>updatePlayButton(false));
  hpAudioEl.addEventListener('ended',()=>{ /* loop=true 不会触发 */ });
  hpAudioEl.addEventListener('error',()=>{
    const ph=document.getElementById('hp-wave-placeholder');
    if(ph){ph.textContent='音频加载失败，请确认 music/dukou.flac 存在';ph.style.display='flex';}
  });
}

// ----------------------------------------------------------------
//  构建 Web Audio 图（首次播放、用户手势后）
// ----------------------------------------------------------------
function ensureAudioGraph(){
  if(hpGraphBuilt)return;
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC)return;
  hpAudioCtx=new AC();
  hpSourceNode=hpAudioCtx.createMediaElementSource(hpAudioEl);
  hpGainNode=hpAudioCtx.createGain();
  hpAnalyser=hpAudioCtx.createAnalyser();
  hpAnalyser.fftSize=2048;                 // 波形采样点数
  hpAnalyser.smoothingTimeConstant=0.0;     // 波形不做平滑，保留真实瞬态
  hpWaveData=new Uint8Array(hpAnalyser.fftSize);

  // 声道检测分支：从源分流到 L/R 分析器（旁路，不影响主输出）
  hpSplitter=hpAudioCtx.createChannelSplitter(2);
  hpLeftAnalyser=hpAudioCtx.createAnalyser();
  hpRightAnalyser=hpAudioCtx.createAnalyser();
  hpLeftAnalyser.fftSize=1024;
  hpRightAnalyser.fftSize=1024;
  hpLeftData=new Uint8Array(hpLeftAnalyser.fftSize);
  hpRightData=new Uint8Array(hpRightAnalyser.fftSize);

  // 主输出链：source → gain(音量) → analyser(波形) → panner(声道平衡) → destination
  hpSourceNode.connect(hpGainNode);
  hpGainNode.connect(hpAnalyser);
  if(hpAudioCtx.createStereoPanner){
    hpPanner=hpAudioCtx.createStereoPanner();
    hpAnalyser.connect(hpPanner);
    hpPanner.connect(hpAudioCtx.destination);
    hpPanner.pan.value=(hpBalance-50)/50;  // 初始平衡（50→0 居中）
  }else{
    hpPanner=null;                          // 回退：直连，声道平衡不可用
    hpAnalyser.connect(hpAudioCtx.destination);
  }
  hpGainNode.gain.value=hpVolume;          // 应用初始音量

  // 声道检测分流（source → splitter → L/R analyser）
  hpSourceNode.connect(hpSplitter);
  hpSplitter.connect(hpLeftAnalyser,0);
  hpSplitter.connect(hpRightAnalyser,1);

  hpGraphBuilt=true;
}

// ----------------------------------------------------------------
//  播放 / 暂停
// ----------------------------------------------------------------
async function toggleHeadphonePlayback(){
  if(!hpAudioEl)initAudioElement();
  ensureAudioGraph();
  // 浏览器自动播放策略：AudioContext 需在用户手势后 resume
  if(hpAudioCtx&&hpAudioCtx.state==='suspended'){
    try{await hpAudioCtx.resume()}catch(e){console.warn('[HeadphoneAudio] resume failed:',e)}
  }
  if(hpAudioEl.paused){
    try{
      await hpAudioEl.play();
      hidePlaceholder();
      startWaveform();
      startResizeWatch();
      startChannelDetection();   // 播放即驱动声道检测
    }catch(e){
      console.warn('[HeadphoneAudio] play() rejected:',e);
      const ph=document.getElementById('hp-wave-placeholder');
      if(ph){ph.textContent='播放被浏览器拦截，请再次点击播放按钮';ph.style.display='flex';}
    }
  }else{
    hpAudioEl.pause();
    stopWaveform();
    stopResizeWatch();
    updateBalanceBars();   // 暂停后 L/R 条回到平衡位置（静止展示）
  }
}

// ----------------------------------------------------------------
//  实时波形渲染
// ----------------------------------------------------------------
function startWaveform(){
  if(!hpCanvasCtx||!hpAnalyser)return;
  sizeCanvas();
  if(hpWaveRAF)cancelAnimationFrame(hpWaveRAF);
  drawWave();
}

function stopWaveform(){
  if(hpWaveRAF){cancelAnimationFrame(hpWaveRAF);hpWaveRAF=null;}
  // 清空画布为静默中线
  if(hpCanvasCtx&&hpCanvas){
    const w=hpCanvas.width,h=hpCanvas.height;
    hpCanvasCtx.clearRect(0,0,w,h);
    drawCenterLine(w,h);
  }
}

function drawWave(){
  hpWaveRAF=requestAnimationFrame(drawWave);
  if(!hpCanvasCtx||!hpAnalyser)return;
  const w=hpCanvas.width,h=hpCanvas.height;
  hpAnalyser.getByteTimeDomainData(hpWaveData); // 取值域波形（0..255，128=零）

  // 背景
  hpCanvasCtx.clearRect(0,0,w,h);
  // 中线
  drawCenterLine(w,h);

  // 主题色
  const isDark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
  const lineColor=isDark?'#22d3ee':'#0891b2';
  const fillColor=isDark?'rgba(34,211,238,0.18)':'rgba(8,145,178,0.16)';

  hpCanvasCtx.lineWidth=2;
  hpCanvasCtx.strokeStyle=lineColor;
  if(isDark){hpCanvasCtx.shadowBlur=8;hpCanvasCtx.shadowColor=lineColor;}

  const n=hpWaveData.length;
  const sliceW=w/n;
  let x=0;

  // 填充区域
  hpCanvasCtx.beginPath();
  hpCanvasCtx.moveTo(0,h/2);
  for(let i=0;i<n;i++){
    const v=hpWaveData[i]/128.0;       // 0..2，1=中线
    const y=(v*h)/2;
    hpCanvasCtx.lineTo(x,y);
    x+=sliceW;
  }
  hpCanvasCtx.lineTo(w,h/2);
  hpCanvasCtx.closePath();
  hpCanvasCtx.fillStyle=fillColor;
  hpCanvasCtx.fill();

  // 描边波形
  x=0;
  hpCanvasCtx.beginPath();
  for(let i=0;i<n;i++){
    const v=hpWaveData[i]/128.0;
    const y=(v*h)/2;
    if(i===0)hpCanvasCtx.moveTo(x,y);else hpCanvasCtx.lineTo(x,y);
    x+=sliceW;
  }
  hpCanvasCtx.stroke();
  if(isDark)hpCanvasCtx.shadowBlur=0; // 复位
}

function drawCenterLine(w,h){
  hpCanvasCtx.save();
  hpCanvasCtx.strokeStyle='rgba(150,150,165,0.22)';
  hpCanvasCtx.lineWidth=1;
  hpCanvasCtx.beginPath();
  hpCanvasCtx.moveTo(0,h/2);
  hpCanvasCtx.lineTo(w,h/2);
  hpCanvasCtx.stroke();
  hpCanvasCtx.restore();
}

// canvas 按 CSS 尺寸 × devicePixelRatio 缩放，保证清晰
function sizeCanvas(){
  if(!hpCanvas)return;
  const dpr=window.devicePixelRatio||1;
  const rect=hpCanvas.getBoundingClientRect();
  const cssW=rect.width||hpCanvas.clientWidth||600;
  const cssH=rect.height||hpCanvas.clientHeight||140;
  hpCanvas.width=Math.max(1,Math.round(cssW*dpr));
  hpCanvas.height=Math.max(1,Math.round(cssH*dpr));
  // 绘制坐标以 device 像素为准，但视觉尺寸由 CSS 控制不变
}

function startResizeWatch(){
  if(hpResizeHandler)return;
  hpResizeHandler=()=>{ if(hpWaveRAF)sizeCanvas(); };
  window.addEventListener('resize',hpResizeHandler);
}
function stopResizeWatch(){
  if(hpResizeHandler){window.removeEventListener('resize',hpResizeHandler);hpResizeHandler=null;}
}

function hidePlaceholder(){
  const ph=document.getElementById('hp-wave-placeholder');
  if(ph)ph.style.display='none';
}

// ----------------------------------------------------------------
//  音量控制 + 显示
// ----------------------------------------------------------------
function setHeadphoneVolume(v){
  hpVolume=Math.max(0,Math.min(1,Number(v)||0));
  if(hpGainNode)hpGainNode.gain.value=hpVolume;
  // 同步滑块（避免与拖动事件互相覆盖）
  const slider=document.getElementById('hp-volume-slider');
  if(slider&&Number(slider.value)/100!==hpVolume){
    slider.value=Math.round(hpVolume*100);
  }
  updateVolumeDisplay();
}

function getHeadphoneVolume(){
  return hpVolume; // 0..1
}

function toggleHeadphoneMute(){
  const btn=document.getElementById('hp-mute-btn');
  if(hpVolume>0){
    hpPrevVolume=hpVolume;
    setHeadphoneVolume(0);
    if(btn)btn.classList.add('muted');
  }else{
    setHeadphoneVolume(hpPrevVolume||HP_DEFAULT_VOLUME);
    if(btn)btn.classList.remove('muted');
  }
}

function updateVolumeDisplay(){
  const valEl=document.getElementById('hp-volume-value');
  if(valEl)valEl.textContent=Math.round(hpVolume*100)+'%';
  const slider=document.getElementById('hp-volume-slider');
  if(slider)slider.value=Math.round(hpVolume*100);
}

// 播放 / 暂停按钮图标切换
function updatePlayButton(playing){
  const btn=document.getElementById('hp-play-btn');
  if(!btn)return;
  if(playing){
    btn.classList.add('playing');
    btn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>';
  }else{
    btn.classList.remove('playing');
    btn.innerHTML='<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
  }
}

// ----------------------------------------------------------------
//  声道检测 + 声道平衡
// ----------------------------------------------------------------

// 注册耳机连接/断开回调（仅注册一次）
function registerHeadphoneHooks(){
  if(hpEventRegistered)return;
  if(typeof onHeadphoneEvent==='function'){
    onHeadphoneEvent('connect',()=>onHeadphoneConnectionChange(true));
    onHeadphoneEvent('disconnect',()=>onHeadphoneConnectionChange(false));
    hpEventRegistered=true;
  }
}

// 耳机连接状态变化
function onHeadphoneConnectionChange(connected){
  if(!connected){
    // 耳机拔出：停止播放并重置声道检测
    if(hpAudioEl&&!hpAudioEl.paused)hpAudioEl.pause();
    resetChannelDetection();
  }else{
    // 耳机插入：准备声道检测（需播放音乐驱动）
    resetChannelDetection();
  }
}

// 重置声道检测状态与 UI
function resetChannelDetection(){
  hpChannelDetected=false;
  hpDetectOkCount=0;
  stopChannelDetection();
  updateChannelUI();
}

function startChannelDetection(){
  if(hpChannelDetected||hpDetectRAF)return;
  hpDetectRAF=requestAnimationFrame(sampleChannels);
}

function stopChannelDetection(){
  if(hpDetectRAF){cancelAnimationFrame(hpDetectRAF);hpDetectRAF=null;}
}

// 采样 L/R 声道 RMS，判定双声道均有信号
function sampleChannels(){
  hpDetectRAF=requestAnimationFrame(sampleChannels);
  if(!hpLeftAnalyser||!hpRightAnalyser)return;
  if(!hpAudioEl||hpAudioEl.paused)return; // 未播放无法检测
  const lRms=channelRms(hpLeftAnalyser,hpLeftData);
  const rRms=channelRms(hpRightAnalyser,hpRightData);
  if(lRms>HP_CH_THRESHOLD&&rRms>HP_CH_THRESHOLD)hpDetectOkCount++;
  else hpDetectOkCount=0;
  updateChannelUI(lRms,rRms);
  if(hpDetectOkCount>=HP_CH_OK_FRAMES){
    hpChannelDetected=true;
    stopChannelDetection();
    updateChannelUI(lRms,rRms);
  }
}

// 计算单声道时域 RMS（0..1，约为振幅均方根）
function channelRms(analyser,buf){
  analyser.getByteTimeDomainData(buf);
  let sum=0;
  for(let i=0;i<buf.length;i++){
    const v=(buf[i]-128)/128; // -1..1
    sum+=v*v;
  }
  return Math.sqrt(sum/buf.length);
}

// 设置声道平衡：0=纯左声道，50=居中，100=纯右声道
function setHeadphoneBalance(v){
  let n=Number(v);
  // 注意：Number('0')===0 是假值，绝不能用 `||50` 兜底，否则 0% 会被误当成 50%（这正是“不能 0% 纯左”的根因）
  if(isNaN(n))n=50;
  hpBalance=Math.max(0,Math.min(100,Math.round(n)));
  if(hpPanner)hpPanner.pan.value=(hpBalance-50)/50; // -1..+1
  updateBalanceDisplay();
  updateBalanceBars();              // L/R 电平条随滑块位置平滑动画
  const slider=document.getElementById('hp-balance-slider');
  if(slider&&Number(slider.value)!==hpBalance)slider.value=hpBalance;
}

function getHeadphoneBalance(){
  return hpBalance;
}

// 声道平衡显示文案
function updateBalanceDisplay(){
  const valEl=document.getElementById('hp-balance-value');
  if(!valEl)return;
  let label;
  if(hpBalance===0)label='纯左声道 (L)';
  else if(hpBalance===100)label='纯右声道 (R)';
  else if(hpBalance===50)label='居中 (C)';
  else if(hpBalance<50)label='偏左 '+(50-hpBalance)+'%';
  else label='偏右 '+(hpBalance-50)+'%';
  valEl.textContent=hpBalance+'% · '+label;
}

// L/R 电平条：按当前平衡位置显示（纯左→L满R空，居中→两半，纯右→R满L空）
// 配合 CSS transition 在拖动滑块时产生平滑动画
function updateBalanceBars(){
  const lBar=document.getElementById('hp-chan-l-level');
  const rBar=document.getElementById('hp-chan-r-level');
  if(!lBar||!rBar)return;
  const pan=(hpBalance-50)/50; // -1..+1
  lBar.style.width=Math.round((1-pan)/2*100)+'%';
  rBar.style.width=Math.round((1+pan)/2*100)+'%';
}

// 更新声道检测 UI（含 L/R 电平条）
function updateChannelUI(lRms,rRms){
  const statusEl=document.getElementById('hp-channel-status');
  const slider=document.getElementById('hp-balance-slider');
  const lBar=document.getElementById('hp-chan-l-level');
  const rBar=document.getElementById('hp-chan-r-level');
  // 播放中：L/R 条 = 实时电平 × 平衡权重（纯左时仅左条跳动，纯右时仅右条跳动）
  if(hpAudioEl&&!hpAudioEl.paused){
    const pan=(hpBalance-50)/50;
    const lW=(1-pan)/2, rW=(1+pan)/2;     // 左/右声道在当前平衡下的权重
    const peak=v=>Math.min(100,Math.round(Math.max(0,v)*300));
    if(lBar)lBar.style.width=peak((lRms||0)*lW)+'%';
    if(rBar)rBar.style.width=peak((rRms||0)*rW)+'%';
  }
  if(!statusEl)return;
  if(!hpChannelDetected){
    statusEl.className='hp-channel-status detecting';
    statusEl.textContent=(hpAudioEl&&!hpAudioEl.paused)
      ?'声道检测中…（左/右声道信号采样）'
      :'声道检测待命 — 请播放音乐以驱动检测';
    if(slider)slider.disabled=true;
  }else{
    statusEl.className='hp-channel-status done';
    statusEl.textContent='声道检测完成：左声道 ✓ 右声道 ✓';
    if(slider)slider.disabled=!hpPanner; // 无 StereoPanner 时仍禁用
  }
}

// ----------------------------------------------------------------
//  清理（离开耳机页面时调用）
//  注意：AudioContext 与音频图【不销毁】—— 同一 HTMLMediaElement 只能
//  创建一次 MediaElementSourceNode，重建会抛 InvalidStateError。
//  因此仅暂停并挂起，再次进入时复用既有图。
// ----------------------------------------------------------------
function stopHeadphoneAudio(){
  if(hpAudioEl&&!hpAudioEl.paused)hpAudioEl.pause();
  stopWaveform();
  stopResizeWatch();
  stopChannelDetection();
  if(hpAudioCtx&&hpAudioCtx.state==='running'){
    hpAudioCtx.suspend().catch(()=>{}); // 挂起以省资源，保留图
  }
  updatePlayButton(false);
}

// ----------------------------------------------------------------
//  工具
// ----------------------------------------------------------------
function formatAudioTime(sec){
  if(!isFinite(sec)||sec<0)sec=0;
  const m=Math.floor(sec/60);
  const s=Math.floor(sec%60);
  return m+':'+String(s).padStart(2,'0');
}
