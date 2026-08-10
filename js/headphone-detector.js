// ================================================================
//  headphone-detector.js — 耳机连接/断开检测
//  依赖：无（DOM 元素由 index.html 提供）
//  导出（全局）：
//    startHeadphoneDetector / stopHeadphoneDetector
//    onHeadphoneEvent / offHeadphoneEvent      — 事件回调 API
//    isHeadphoneConnected / getHeadphoneDevices — 状态查询
//    refreshHeadphoneDetection                  — 手动重新扫描
//
//  检测原理：
//    1. navigator.mediaDevices.enumerateDevices() 枚举音频输出设备
//    2. navigator.mediaDevices 'devicechange' 事件监听设备插拔
//    3. 通过设备标签关键词（headphone / 耳机 / AirPods 等）判定（需授权才有标签，
//       未授权时标签为空，但仍可依据设备数量变化记录插拔事件）
//    注：收听测试直接走系统默认输出，无需任何授权。
//
//  事件回调 API：
//    onHeadphoneEvent('connect',    cb)  — 耳机连接时触发
//    onHeadphoneEvent('disconnect', cb)  — 耳机断开时触发
//    onHeadphoneEvent('change',     cb)  — 状态变化时触发（含 connect/disconnect）
//    回调参数：{ connected, device, devices, timestamp }
// ================================================================

// 耳机关键词（用于匹配设备标签）
const HEADPHONE_KEYWORDS=[
  'headphone','headphones','headset','earphone','earphones','earbuds',
  '耳机','头戴','耳塞','耳麦',
  'airpod','airpods','galaxy buds','pixel buds','powerbeats','beats',
  '蓝牙耳机','蓝牙','bluetooth','wireless',
  'usb audio','usb',
];

// 模块状态
let headphoneConnected=false;              // 当前连接状态
let headphoneListeners={                   // 事件回调队列
  connect:[],
  disconnect:[],
  change:[]
};
let headphoneDeviceChangeHandler=null;     // devicechange 事件处理器
let headphoneMatchedDevice=null;           // 当前匹配到的耳机设备（供参考）
let headphoneEventLog=[];                  // 事件日志
const HP_MAX_LOG=50;

// ----------------------------------------------------------------
//  事件回调 API
// ----------------------------------------------------------------

/**
 * 注册事件回调
 * @param {string}   event    — 'connect' | 'disconnect' | 'change'
 * @param {function} callback — 回调函数，参数为事件数据对象
 */
function onHeadphoneEvent(event,callback){
  if(headphoneListeners[event]&&typeof callback==='function'){
    headphoneListeners[event].push(callback);
  }
}

/**
 * 注销事件回调
 * @param {string}   event    — 'connect' | 'disconnect' | 'change'
 * @param {function} callback — 要移除的回调函数引用
 */
function offHeadphoneEvent(event,callback){
  if(headphoneListeners[event]){
    headphoneListeners[event]=headphoneListeners[event].filter(fn=>fn!==callback);
  }
}

/**
 * 查询当前耳机连接状态
 * @returns {boolean}
 */
function isHeadphoneConnected(){
  return headphoneConnected;
}

/**
 * 获取最近一次检测到的音频输出设备列表
 * @returns {Promise<MediaDeviceInfo[]>}
 */
async function getHeadphoneDevices(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.enumerateDevices)return[];
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    return devices.filter(d=>d.kind==='audiooutput');
  }catch(e){return []}
}

// ----------------------------------------------------------------
//  内部：标签匹配 / 检测 / 通知
// ----------------------------------------------------------------

/**
 * 根据设备标签判断是否为耳机
 * @param {string} label — 设备标签
 * @returns {boolean}
 */
function guessHeadphoneFromLabel(label){
  if(!label)return false;
  const lower=label.toLowerCase();
  return HEADPHONE_KEYWORDS.some(kw=>lower.includes(kw.toLowerCase()));
}

/**
 * 执行一次耳机检测
 * @returns {Promise<{connected:boolean, devices:MediaDeviceInfo[], matchedDevice:MediaDeviceInfo|null, hasLabels:boolean}>}
 */
async function detectHeadphones(){
  if(!navigator.mediaDevices||!navigator.mediaDevices.enumerateDevices){
    return{connected:false,devices:[],matchedDevice:null,hasLabels:false,reason:'unsupported'};
  }
  try{
    const devices=await navigator.mediaDevices.enumerateDevices();
    const outputs=devices.filter(d=>d.kind==='audiooutput');

    // 判断标签是否可用（未授权时标签为空字符串）
    const hasLabels=outputs.some(d=>d.label&&d.label.length>0);

    // 优先通过标签关键词匹配
    let connected=false;
    let matchedDevice=null;
    if(hasLabels){
      for(const dev of outputs){
        if(guessHeadphoneFromLabel(dev.label)){
          connected=true;
          matchedDevice=dev;
          break;
        }
      }
    }

    // 状态变化检测
    const wasConnected=headphoneConnected;
    headphoneConnected=connected;
    headphoneMatchedDevice=matchedDevice; // 缓存供音频路由（setSinkId）使用

    if(connected!==wasConnected){
      const eventData={
        connected:connected,
        device:matchedDevice,
        devices:outputs,
        timestamp:Date.now()
      };
      if(connected){
        notifyHeadphoneListeners('connect',eventData);
        addHeadphoneEventLog('connect',matchedDevice);
      }else{
        notifyHeadphoneListeners('disconnect',eventData);
        addHeadphoneEventLog('disconnect',null);
      }
      notifyHeadphoneListeners('change',eventData);
    }

    return{connected,devices:outputs,matchedDevice,hasLabels};
  }catch(e){
    return{connected:false,devices:[],matchedDevice:null,hasLabels:false,reason:'error',error:e};
  }
}

/**
 * 通知所有注册的回调
 * @param {string} event — 'connect' | 'disconnect' | 'change'
 * @param {object} data  — 事件数据
 */
function notifyHeadphoneListeners(event,data){
  if(headphoneListeners[event]){
    headphoneListeners[event].forEach(fn=>{
      try{fn(data)}catch(e){console.error('[HeadphoneDetector] listener error:',e)}
    });
  }
}

/**
 * 添加事件到日志
 * @param {string} type   — 'connect' | 'disconnect'
 * @param {MediaDeviceInfo|null} device
 */
function addHeadphoneEventLog(type,device){
  headphoneEventLog.unshift({
    type:type,
    deviceLabel:device?device.label:'未知设备',
    timestamp:Date.now()
  });
  if(headphoneEventLog.length>HP_MAX_LOG)headphoneEventLog.pop();
}

// ----------------------------------------------------------------
//  手动重新扫描设备（无需授权；标签在未授权时为空白，但设备计数与
//  插拔事件仍然有效）
// ----------------------------------------------------------------

/**
 * 手动重新扫描设备
 * @returns {Promise<object>} 检测结果
 */
async function refreshHeadphoneDetection(){
  const result=await detectHeadphones();
  updateHeadphoneUI(result);
  return result;
}

// ----------------------------------------------------------------
//  UI 更新
// ----------------------------------------------------------------

function formatTime(ts){
  const d=new Date(ts);
  const pad=n=>String(n).padStart(2,'0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function updateHeadphoneUI(result){
  const hero=document.getElementById('hp-status-hero');
  const heroIcon=document.getElementById('hp-hero-icon');
  const heroLabel=document.getElementById('hp-hero-label');
  const heroDetail=document.getElementById('hp-hero-detail');
  const statusDot=document.getElementById('hp-status-dot');
  const statusText=document.getElementById('hp-status-text');
  const deviceList=document.getElementById('hp-device-list');
  const eventLogEl=document.getElementById('hp-event-log');

  // 状态指示灯（连接状态仅用于状态点配色，不再作为内容门槛）
  const page=document.getElementById('headphone-page');
  if(page){
    page.classList.toggle('hp-connected',!!result.connected);
    page.classList.toggle('hp-disconnected',!result.connected);
  }
  if(result.connected){
    if(statusDot)statusDot.className='status-dot active-dot';
    if(statusText)statusText.textContent='已连接';
    if(hero){hero.className='hp-status-hero connected';heroLabel.textContent='耳机已连接';heroDetail.textContent=result.matchedDevice?result.matchedDevice.label:'已检测到耳机设备';}
  }else{
    if(statusDot)statusDot.className='status-dot idle';
    if(statusText)statusText.textContent='未连接';
    if(hero){hero.className='hp-status-hero disconnected';heroLabel.textContent='耳机未连接';heroDetail.textContent='';}
  }

  // 设备列表
  if(deviceList){
    if(!result.devices||result.devices.length===0){
      deviceList.innerHTML='<div class="hp-device-empty">未发现音频输出设备</div>';
    }else{
      deviceList.innerHTML=result.devices.map(dev=>{
        const isMatched=result.matchedDevice&&dev.deviceId===result.matchedDevice.deviceId;
        const label=dev.label||'(未授权 — 标签不可见)';
        const shortId=dev.deviceId?dev.deviceId.substring(0,8):'--------';
        return `<div class="hp-device-item${isMatched?' matched':''}">
          <div class="hp-dev-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3zM3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z"/>
            </svg>
          </div>
          <div class="hp-dev-info">
            <div class="hp-dev-label">${escapeHtml(label)}</div>
            <div class="hp-dev-id">ID: ${shortId}…</div>
          </div>
          <span class="hp-dev-tag">${isMatched?'耳机':'输出'}</span>
        </div>`;
      }).join('');
    }
  }

  // 事件日志
  if(eventLogEl){
    if(headphoneEventLog.length===0){
      eventLogEl.innerHTML='<div class="hp-event-empty">暂无事件 — 插拔耳机将在此记录</div>';
    }else{
      eventLogEl.innerHTML=headphoneEventLog.map(ev=>{
        const isConnect=ev.type==='connect';
        return `<div class="hp-event-item ${ev.type}">
          <span class="hp-ev-dot"></span>
          <span class="hp-ev-type">${isConnect?'已连接':'已断开'}</span>
          <span class="hp-ev-device">${escapeHtml(ev.deviceLabel)}</span>
          <span class="hp-ev-time">${formatTime(ev.timestamp)}</span>
        </div>`;
      }).join('');
    }
  }
}

function escapeHtml(str){
  if(!str)return'';
  return str.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/**
 * 获取当前匹配到的耳机设备 ID（供音频模块通过 setSinkId 路由输出）
 * @returns {string|null}
 */
function getHeadphoneMatchedDeviceId(){
  return headphoneMatchedDevice?headphoneMatchedDevice.deviceId:null;
}

/**
 * 获取当前匹配到的耳机设备对象
 * @returns {MediaDeviceInfo|null}
 */
function getHeadphoneMatchedDevice(){
  return headphoneMatchedDevice;
}

// ----------------------------------------------------------------
//  启动 / 停止
// ----------------------------------------------------------------

function startHeadphoneDetector(){
  // 重置状态
  headphoneConnected=false;

  // 更新状态指示
  const dot=document.getElementById('hp-status-dot');
  const text=document.getElementById('hp-status-text');
  if(dot)dot.className='status-dot idle';
  if(text)text.textContent='检测中';

  // 初始检测
  detectHeadphones().then(result=>updateHeadphoneUI(result));

  // 初始化测试音/波形/音量模块（不自动播放，等用户点播放）
  if(typeof startHeadphoneAudio==='function')startHeadphoneAudio();

  // 监听设备变化
  if(navigator.mediaDevices&&navigator.mediaDevices.addEventListener){
    headphoneDeviceChangeHandler=()=>{
      detectHeadphones().then(result=>updateHeadphoneUI(result));
    };
    navigator.mediaDevices.addEventListener('devicechange',headphoneDeviceChangeHandler);
  }
}

function stopHeadphoneDetector(){
  // 移除设备变化监听
  if(headphoneDeviceChangeHandler&&navigator.mediaDevices&&navigator.mediaDevices.removeEventListener){
    navigator.mediaDevices.removeEventListener('devicechange',headphoneDeviceChangeHandler);
    headphoneDeviceChangeHandler=null;
  }
  // 停止并清理音乐播放模块
  if(typeof stopHeadphoneAudio==='function')stopHeadphoneAudio();
}
