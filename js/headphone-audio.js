// ================================================================
//  headphone-audio.js — 耳机测试音（实时合成，无需任何音频文件）
//  依赖：无（DOM 元素由 index.html 提供）
//  导出（全局）：
//    startHeadphoneAudio / stopHeadphoneAudio   — 生命周期（由 headphone-detector 调用）
//    toggleHeadphonePlayback                    — 播放 / 暂停
//    setHeadphoneVolume(v) / getHeadphoneVolume — 音量控制（v: 0..1）
//    toggleHeadphoneMute                        — 静音切换
//    setHeadphoneFreq(v) / getHeadphoneFreq     — 测试音频率（Hz）
//    setHeadphoneWaveType(t) / getHeadphoneWaveType — 波形类型
//    startStereoPingTest                        — 左右声道交替 ping 测试
//    setHeadphoneBalance(v) / getHeadphoneBalance — 声道平衡（0=纯左,50=居中,100=纯右）
//
//  音频图（Web Audio API）—— 主测试音：
//    OscillatorNode ─▶ GainNode(音量) ─▶ AnalyserNode(波形) ─▶ StereoPannerNode(声道平衡) ─▶ destination
//                                                 StereoPanner ─▶ ChannelSplitter ─▶ L/R AnalyserNode（声道检测）
//  说明：不再使用本地 flac，改由 OscillatorNode 合成测试音，规避了浏览器对本地
//        音频文件的编解码/加载限制，且可在任意环境下稳定发声。
// ================================================================

const HP_DEFAULT_VOLUME=1.0;   // 0..1（默认 100% 最大音量）
const HP_DEFAULT_FREQ=1000;    // Hz
const HP_DEFAULT_WAVE='sine';

// 模块状态
let hpAudioCtx=null;         // AudioContext（持久，图表只在其中构建一次）
let hpGainNode=null;         // GainNode —— 主测试音音量
let hpMasterAnalyser=null;   // AnalyserNode —— 波形采样
let hpWaveData=null;         // Uint8Array 波形缓冲
let hpCanvas=null;           // 波形 canvas
let hpCanvasCtx=null;        // canvas 2d 上下文
let hpWaveRAF=null;          // 波形 requestAnimationFrame 句柄
let hpVolume=HP_DEFAULT_VOLUME;
let hpPrevVolume=HP_DEFAULT_VOLUME;// 静音前的音量
let hpGraphBuilt=false;      // 音频图是否已构建

// 主测试音（OscillatorNode 只能 start/stop 一次，故每次播放重建）
let hpOsc=null;              // 当前主测试音振荡器
let hpPlaying=false;         // 主测试音是否正在播放
let hpFreq=HP_DEFAULT_FREQ;  // 频率 Hz
let hpWaveType=HP_DEFAULT_WAVE;

// 声道检测 / 平衡
let hpSplitter=null;         // ChannelSplitterNode（声道分流）
let hpLeftAnalyser=null;     // 左声道分析
let hpRightAnalyser=null;    // 右声道分析
let hpLeftData=null;         // 左声道时域缓冲
let hpRightData=null;        // 右声道时域缓冲
let hpPanner=null;           // StereoPannerNode（声道平衡）
let hpBalance=50;            // 声道平衡 0..100（50=居中）
let hpChannelDetected=false; // 声道检测是否完成
let hpDetectRAF=null;        // 声道检测 RAF 句柄
let hpDetectOkCount=0;       // 连续达标帧计数
let hpEventRegistered=false; // 是否已注册耳机连接事件

// 左右声道交替 ping 测试
let hpPinging=false;         // 是否正在 ping 测试
let hpPingOsc=null;

const HP_CH_THRESHOLD=0.015;// 声道 RMS 阈值
const HP_CH_OK_FRAMES=3;    // 连续达标帧数

// ----------------------------------------------------------------
//  初始化（进入耳机页面时调用，不自动播放）
// ----------------------------------------------------------------
function startHeadphoneAudio(){
  cacheCanvas();
  registerHeadphoneHooks();   // 注册耳机连接/断开回调（仅一次）
  updateVolumeDisplay();
  updateBalanceDisplay();
  updateBalanceBars();        // L/R 条按默认平衡（居中 50/50）显示
  updateToneDesc();
  updateChannelUI();
  updatePlayButton(false);
  updatePingButton(false);
}

// 缓存 canvas 与上下文
function cacheCanvas(){
  hpCanvas=document.getElementById('hp-waveform');
  if(hpCanvas)hpCanvasCtx=hpCanvas.getContext('2d');
}

// ----------------------------------------------------------------
//  构建 Web Audio 图（首次播放、用户手势后）
//  仅构建一次：振荡器在每次播放时单独创建并接入 GainNode。
// ----------------------------------------------------------------
function ensureAudioGraph(){
  if(hpGraphBuilt)return;
  const AC=window.AudioContext||window.webkitAudioContext;
  if(!AC)return;
  hpAudioCtx=new AC();

  hpGainNode=hpAudioCtx.createGain();
  hpGainNode.gain.value=hpVolume;

  hpMasterAnalyser=hpAudioCtx.createAnalyser();
  hpMasterAnalyser.fftSize=2048;
  hpMasterAnalyser.smoothingTimeConstant=0.0;
  hpWaveData=new Uint8Array(hpMasterAnalyser.fftSize);

  // 声道检测分支
  hpSplitter=hpAudioCtx.createChannelSplitter(2);
  hpLeftAnalyser=hpAudioCtx.createAnalyser();
  hpRightAnalyser=hpAudioCtx.createAnalyser();
  hpLeftAnalyser.fftSize=1024;
  hpRightAnalyser.fftSize=1024;
  hpLeftData=new Uint8Array(hpLeftAnalyser.fftSize);
  hpRightData=new Uint8Array(hpRightAnalyser.fftSize);

  // 主输出链：gain(音量) → analyser(波形) → panner(平衡) → destination
  hpGainNode.connect(hpMasterAnalyser);
  if(hpAudioCtx.createStereoPanner){
    hpPanner=hpAudioCtx.createStereoPanner();
    hpMasterAnalyser.connect(hpPanner);
    hpPanner.connect(hpAudioCtx.destination);
    hpPanner.pan.value=(hpBalance-50)/50;
    // 声道检测分流（panner → splitter → L/R analyser）
    hpPanner.connect(hpSplitter);
    hpSplitter.connect(hpLeftAnalyser,0);
    hpSplitter.connect(hpRightAnalyser,1);
  }else{
    hpPanner=null;            // 回退：直连，声道平衡不可用
    hpMasterAnalyser.connect(hpAudioCtx.destination);
    // 无 StereoPanner 时仍尝试分流（双声道一致）
    hpMasterAnalyser.connect(hpSplitter);
    hpSplitter.connect(hpLeftAnalyser,0);
    hpSplitter.connect(hpRightAnalyser,1);
  }

  hpGraphBuilt=true;
}

// 创建并接入一个主测试音振荡器
function createMainOscillator(){
  if(!hpAudioCtx)return null;
  const osc=hpAudioCtx.createOscillator();
  osc.type=hpWaveType;
  osc.frequency.setValueAtTime(hpFreq,hpAudioCtx.currentTime);
  osc.connect(hpGainNode);
  return osc;
}

// ----------------------------------------------------------------
//  播放 / 暂停
// ----------------------------------------------------------------
async function toggleHeadphonePlayback(){
  ensureAudioGraph();
  if(!hpAudioCtx)return;
  // 自动播放策略：需在用户手势后 resume
  if(hpAudioCtx.state==='suspended'){
    try{await hpAudioCtx.resume()}catch(e){console.warn('[HeadphoneAudio] resume failed:',e)}
  }
  if(hpPlaying){
    stopMainTone(false);
  }else{
    startMainTone();
  }
}

// 启动主测试音（带防爆音淡入）
function startMainTone(){
  if(!hpAudioCtx||hpPlaying)return;
  hpOsc=createMainOscillator();
  if(!hpOsc)return;
  const now=hpAudioCtx.currentTime;
  // 淡入：0 → 当前音量（约 30ms），避免咔哒声
  hpGainNode.gain.cancelScheduledValues(now);
  hpGainNode.gain.setValueAtTime(0,now);
  hpGainNode.gain.linearRampToValueAtTime(hpVolume,now+0.03);
  try{hpOsc.start(now)}catch(e){console.warn('[HeadphoneAudio] osc.start failed:',e);return;}
  hpPlaying=true;
  hidePlaceholder();
  startWaveform();
  startResizeWatch();
  startChannelDetection();
  updatePlayButton(true);
  updatePingButton(true);   // ping 期间禁用，避免叠加
}

// 停止主测试音（带淡出）
function stopMainTone(immediate){
  if(!hpAudioCtx||!hpPlaying){hpPlaying=false;return;}
  const now=hpAudioCtx.currentTime;
  hpGainNode.gain.cancelScheduledValues(now);
  hpGainNode.gain.setValueAtTime(hpGainNode.gain.value,now);
  hpGainNode.gain.linearRampToValueAtTime(0,now+(immediate?0.01:0.05));
  try{hpOsc.stop(now+(immediate?0.02:0.07))}catch(e){}
  const stoppedOsc=hpOsc;
  hpOsc=null;
  hpPlaying=false;
  // 断开振荡器节点回收
  setTimeout(()=>{try{stoppedOsc&&stoppedOsc.disconnect()}catch(e){}},(immediate?40:90));
  stopWaveform();
  stopResizeWatch();
  if(!hpPinging)stopChannelDetection();
  updatePlayButton(false);
  updatePingButton(false);
  updateBalanceBars();   // 停止后 L/R 条回到平衡位置（静止展示）
}

// ----------------------------------------------------------------
//  实时波形渲染
// ----------------------------------------------------------------
function startWaveform(){
  if(!hpCanvasCtx||!hpMasterAnalyser)return;
  sizeCanvas();
  if(hpWaveRAF)cancelAnimationFrame(hpWaveRAF);
  drawWave();
}

function stopWaveform(){
  if(hpWaveRAF){cancelAnimationFrame(hpWaveRAF);hpWaveRAF=null;}
  if(hpCanvasCtx&&hpCanvas){
    const w=hpCanvas.width,h=hpCanvas.height;
    hpCanvasCtx.clearRect(0,0,w,h);
    drawCenterLine(w,h);
  }
}

function drawWave(){
  hpWaveRAF=requestAnimationFrame(drawWave);
  if(!hpCanvasCtx||!hpMasterAnalyser)return;
  const w=hpCanvas.width,h=hpCanvas.height;
  hpMasterAnalyser.getByteTimeDomainData(hpWaveData);

  hpCanvasCtx.clearRect(0,0,w,h);
  drawCenterLine(w,h);

  const isDark=window.matchMedia&&window.matchMedia('(prefers-color-scheme: dark)').matches;
  const lineColor=isDark?'#22d3ee':'#0891b2';
  const fillColor=isDark?'rgba(34,211,238,0.18)':'rgba(8,145,178,0.16)';

  hpCanvasCtx.lineWidth=2;
  hpCanvasCtx.strokeStyle=lineColor;
  if(isDark){hpCanvasCtx.shadowBlur=8;hpCanvasCtx.shadowColor=lineColor;}

  const n=hpWaveData.length;
  const sliceW=w/n;
  let x=0;

  hpCanvasCtx.beginPath();
  hpCanvasCtx.moveTo(0,h/2);
  for(let i=0;i<n;i++){
    const v=hpWaveData[i]/128.0;
    const y=(v*h)/2;
    hpCanvasCtx.lineTo(x,y);
    x+=sliceW;
  }
  hpCanvasCtx.lineTo(w,h/2);
  hpCanvasCtx.closePath();
  hpCanvasCtx.fillStyle=fillColor;
  hpCanvasCtx.fill();

  x=0;
  hpCanvasCtx.beginPath();
  for(let i=0;i<n;i++){
    const v=hpWaveData[i]/128.0;
    const y=(v*h)/2;
    if(i===0)hpCanvasCtx.moveTo(x,y);else hpCanvasCtx.lineTo(x,y);
    x+=sliceW;
  }
  hpCanvasCtx.stroke();
  if(isDark)hpCanvasCtx.shadowBlur=0;
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

function sizeCanvas(){
  if(!hpCanvas)return;
  const dpr=window.devicePixelRatio||1;
  const rect=hpCanvas.getBoundingClientRect();
  const cssW=rect.width||hpCanvas.clientWidth||600;
  const cssH=rect.height||hpCanvas.clientHeight||140;
  hpCanvas.width=Math.max(1,Math.round(cssW*dpr));
  hpCanvas.height=Math.max(1,Math.round(cssH*dpr));
}

function startResizeWatch(){
  if(hpResizeHandler)return;
  hpResizeHandler=()=>{ if(hpWaveRAF)sizeCanvas(); };
  window.addEventListener('resize',hpResizeHandler);
}
let hpResizeHandler=null;
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
  const slider=document.getElementById('hp-volume-slider');
  if(slider&&Number(slider.value)/100!==hpVolume)slider.value=Math.round(hpVolume*100);
  updateVolumeDisplay();
}

function getHeadphoneVolume(){return hpVolume;}

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
//  测试音参数：频率 / 波形类型
// ----------------------------------------------------------------
function setHeadphoneFreq(v){
  let f=Math.max(20,Math.min(8000,Math.round(Number(v)||HP_DEFAULT_FREQ)));
  hpFreq=f;
  if(hpOsc&&hpAudioCtx){
    // 平滑过渡，避免拖动滑块时产生阶跃爆音
    hpOsc.frequency.setTargetAtTime(f,hpAudioCtx.currentTime,0.01);
  }
  const slider=document.getElementById('hp-freq-slider');
  if(slider&&Number(slider.value)!==f)slider.value=f;
  updateFreqDisplay();
  updateToneDesc();
}

function getHeadphoneFreq(){return hpFreq;}

function setHeadphoneWaveType(t){
  if(!t||!['sine','triangle','square','sawtooth'].includes(t))return;
  hpWaveType=t;
  if(hpOsc)hpOsc.type=t;
  // 按钮高亮
  document.querySelectorAll('#hp-wave-btns .hp-wave-btn').forEach(b=>{
    b.classList.toggle('active',b.getAttribute('data-wave')===t);
  });
  updateToneDesc();
}

function getHeadphoneWaveType(){return hpWaveType;}

function updateFreqDisplay(){
  const el=document.getElementById('hp-freq-value');
  if(el)el.textContent=formatFreq(hpFreq);
}

function updateToneDesc(){
  const el=document.getElementById('hp-tone-desc');
  if(el)el.textContent=({sine:'正弦波',triangle:'三角波',square:'方波',sawtooth:'锯齿波'}[hpWaveType]||'正弦波')+' · '+formatFreq(hpFreq);
}

function formatFreq(hz){
  if(hz>=1000)return (hz/1000).toFixed(hz%1000===0?1:2).replace(/\.?0+$/,'')+' kHz';
  return Math.round(hz)+' Hz';
}

// ----------------------------------------------------------------
//  左右声道交替 ping 测试
//  独立于主测试音：临时振荡器 → 独立 gain（包络）→ 独立 panner（左右切换）
//  panner 同时接入 hpSplitter，使 L/R 电平条跟随跳动。
// ----------------------------------------------------------------
async function startStereoPingTest(){
  ensureAudioGraph();
  if(!hpAudioCtx||hpPinging)return;
  if(hpAudioCtx.state==='suspended'){
    try{await hpAudioCtx.resume()}catch(e){console.warn('[HeadphoneAudio] resume failed:',e)}
  }
  // 暂停主测试音，避免叠加干扰
  if(hpPlaying)stopMainTone(true);

  hpPinging=true;
  updatePingButton(true);
  const ctx=hpAudioCtx;
  const t0=ctx.currentTime+0.06;
  const pingOsc=ctx.createOscillator();
  const pingGain=ctx.createGain();
  const pingPanner=ctx.createStereoPanner();
  pingOsc.type='sine';
  pingOsc.frequency.setValueAtTime(880,t0);
  pingOsc.connect(pingGain);
  pingGain.connect(pingPanner);
  pingPanner.connect(ctx.destination);
  pingPanner.connect(hpSplitter); // L/R 表跟随

  const level=0.9, beepDur=0.42, gap=0.12;
  const seq=[-1,1,-1,1]; // L R L R
  pingGain.gain.setValueAtTime(0,t0);
  let tt=t0;
  seq.forEach(pan=>{
    pingPanner.pan.setValueAtTime(pan,tt);
    pingGain.gain.linearRampToValueAtTime(level,tt+0.02);
    pingGain.gain.setValueAtTime(level,tt+beepDur-0.04);
    pingGain.gain.linearRampToValueAtTime(0,tt+beepDur);
    tt+=beepDur+gap;
  });
  try{pingOsc.start(t0);pingOsc.stop(tt+0.05);}catch(e){console.warn('[HeadphoneAudio] ping start/stop failed:',e)}

  hpPingOsc=pingOsc;
  startChannelDetection();

  pingOsc.onended=()=>{
    try{pingOsc.disconnect();pingGain.disconnect();pingPanner.disconnect();}catch(e){}
    hpPinging=false;
    hpPingOsc=null;
    updatePingButton(false);
    if(!hpPlaying)stopChannelDetection();
  };
}

function updatePingButton(active){
  const btn=document.getElementById('hp-ping-btn');
  if(!btn)return;
  if(active){
    btn.classList.add('active');
    btn.disabled=true;
    btn.textContent='测试中… 左右声道交替';
  }else{
    btn.classList.remove('active');
    btn.disabled=false;
    btn.textContent='左右声道交替测试';
  }
}

// ----------------------------------------------------------------
//  声道检测 + 声道平衡
// ----------------------------------------------------------------
function registerHeadphoneHooks(){
  if(hpEventRegistered)return;
  if(typeof onHeadphoneEvent==='function'){
    onHeadphoneEvent('connect',()=>onHeadphoneConnectionChange(true));
    onHeadphoneEvent('disconnect',()=>onHeadphoneConnectionChange(false));
    hpEventRegistered=true;
  }
}

function onHeadphoneConnectionChange(connected){
  if(!connected){
    if(hpPlaying)stopMainTone(true);
    resetChannelDetection();
  }else{
    resetChannelDetection();
  }
}

function resetChannelDetection(){
  hpChannelDetected=false;
  hpDetectOkCount=0;
  stopChannelDetection();
  updateChannelUI();
}

function isAudioFlowing(){
  return hpPlaying||hpPinging;
}

function startChannelDetection(){
  if(hpChannelDetected||hpDetectRAF)return;
  hpDetectRAF=requestAnimationFrame(sampleChannels);
}

function stopChannelDetection(){
  if(hpDetectRAF){cancelAnimationFrame(hpDetectRAF);hpDetectRAF=null;}
}

function sampleChannels(){
  hpDetectRAF=requestAnimationFrame(sampleChannels);
  if(!hpLeftAnalyser||!hpRightAnalyser)return;
  if(!isAudioFlowing())return; // 无音频输出无法检测
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
  // 注意：Number('0')===0 是假值，绝不能用 `||50` 兜底，否则 0% 会被误当成 50%
  if(isNaN(n))n=50;
  hpBalance=Math.max(0,Math.min(100,Math.round(n)));
  if(hpPanner)hpPanner.pan.value=(hpBalance-50)/50; // -1..+1
  updateBalanceDisplay();
  updateBalanceBars();
  const slider=document.getElementById('hp-balance-slider');
  if(slider&&Number(slider.value)!==hpBalance)slider.value=hpBalance;
}

function getHeadphoneBalance(){return hpBalance;}

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
  if(isAudioFlowing()){
    const pan=(hpBalance-50)/50;
    const lW=(1-pan)/2, rW=(1+pan)/2;
    const peak=v=>Math.min(100,Math.round(Math.max(0,v)*300));
    if(lBar)lBar.style.width=peak((lRms||0)*lW)+'%';
    if(rBar)rBar.style.width=peak((rRms||0)*rW)+'%';
  }
  if(!statusEl)return;
  if(!hpChannelDetected){
    statusEl.className='hp-channel-status detecting';
    statusEl.textContent=isAudioFlowing()
      ?'声道检测中…（左/右声道信号采样）'
      :'声道检测待命 — 请播放测试音以驱动检测';
    if(slider)slider.disabled=true;
  }else{
    statusEl.className='hp-channel-status done';
    statusEl.textContent='声道检测完成：左声道 ✓ 右声道 ✓';
    if(slider)slider.disabled=!hpPanner;
  }
}

// ----------------------------------------------------------------
//  清理（离开耳机页面时调用）
// ----------------------------------------------------------------
function stopHeadphoneAudio(){
  if(hpPlaying)stopMainTone(true);
  if(hpPinging&&hpPingOsc){try{hpPingOsc.stop()}catch(e){}}
  hpPinging=false;
  stopWaveform();
  stopResizeWatch();
  stopChannelDetection();
  if(hpAudioCtx&&hpAudioCtx.state==='running'){
    hpAudioCtx.suspend().catch(()=>{}); // 挂起以省资源，保留图
  }
  updatePlayButton(false);
  updatePingButton(false);
}
