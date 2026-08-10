// ================================================================
//  network-detector.js — 网络检测
//  模块级局部变量（避免污染全局），仅 start/stop 暴露到全局
//  依赖：无（纯浏览器 API：navigator.onLine / navigator.connection）
//  导出（全局）：
//    startNetworkDetector / stopNetworkDetector
// ================================================================

let netOnlineHandler=null;     // window 'online' 事件
let netOfflineHandler=null;    // window 'offline' 事件
let netConnHandler=null;       // navigator.connection 'change' 事件
let netPingTimer=null;         // 实测延迟轮询定时器
let netPingSamples=[];         // 实测延迟样本（ms）
let netChartCtx=null;          // canvas 2d 上下文（仅绘制时缓存）
const NET_PING_INTERVAL=2000; // 每 2 秒采样一次
const NET_MAX_SAMPLES=60;      // 曲线最多保留点数
const NET_PING_COLOR='#f59e0b'; // 黄色（canvas 不支持 CSS 变量，硬编码）

// 读取 Network Information API 字段
function readNetConnection(){
  const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  const set=(id,val)=>{const el=document.getElementById(id);if(el)el.textContent=val;};
  if(!c){
    set('net-type','—');set('net-effective','—');set('net-downlink','—');
    set('net-rtt','—');set('net-savedata','—');
    return;
  }
  set('net-type', c.type ? c.type : '未知');
  set('net-effective', c.effectiveType ? c.effectiveType.toUpperCase() : '未知');
  set('net-downlink', typeof c.downlink==='number' ? c.downlink.toFixed(1)+' Mbps' : '未知');
  set('net-rtt', typeof c.rtt==='number' ? Math.round(c.rtt)+' ms' : '未知');
  set('net-savedata', c.saveData ? '已开启' : '关闭');
}

function updateNetOnline(online){
  const dot=document.getElementById('net-status-dot');
  const text=document.getElementById('net-status-text');
  const badge=document.getElementById('net-online-badge');
  if(dot)dot.className='status-dot '+(online?'active-dot':'idle');
  if(text)text.textContent=online?'在线':'离线';
  if(badge){
    badge.className='net-online-badge '+(online?'online':'offline');
    badge.textContent=online?'在线':'离线';
  }
}

// 单次实测延迟：同域 HEAD 请求计时（最贴近真实网络往返）
async function runSinglePing(){
  const url=(location.href||'').split('#')[0];
  const t0=performance.now();
  try{
    const ctrl=new AbortController();
    const to=setTimeout(()=>ctrl.abort(),5000);
    await fetch(url+'?_ping='+Date.now(),{method:'HEAD',cache:'no-store',signal:ctrl.signal});
    clearTimeout(to);
    return performance.now()-t0;
  }catch(e){
    return null; // 失败（离线 / 超时 / CORS）
  }
}

function pushPingSample(ms){
  if(ms===null||!isFinite(ms))return;
  netPingSamples.push(ms);
  if(netPingSamples.length>NET_MAX_SAMPLES)netPingSamples.shift();
  const min=Math.min.apply(null,netPingSamples);
  const max=Math.max.apply(null,netPingSamples);
  const avg=netPingSamples.reduce((a,b)=>a+b,0)/netPingSamples.length;
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  set('net-ping-min',Math.round(min)+' ms');
  set('net-ping-avg',Math.round(avg)+' ms');
  set('net-ping-max',Math.round(max)+' ms');
  set('net-ping-count',String(netPingSamples.length));
  const big=document.getElementById('net-ping-big');
  if(big){
    big.textContent=Math.round(ms)+' ms';
    big.className='net-ping-big '+(ms<80?'good':ms>250?'poor':'');
  }
}

async function netPingLoop(){
  const ms=await runSinglePing();
  pushPingSample(ms);
  drawNetChart();
  netPingTimer=setTimeout(netPingLoop,NET_PING_INTERVAL);
}

// 延迟曲线（sparkline，右侧对齐滚动）
function drawNetChart(){
  const canvas=document.getElementById('net-ping-chart');
  if(!canvas)return;
  if(!netChartCtx)netChartCtx=canvas.getContext('2d');
  const dpr=window.devicePixelRatio||1;
  const w=canvas.clientWidth||canvas.width;
  const h=canvas.clientHeight||140;
  if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
  }
  const ctx=netChartCtx;
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,w,h);
  // 背景网格线
  ctx.strokeStyle='rgba(127,127,127,0.12)';ctx.lineWidth=1;
  for(let i=1;i<4;i++){const y=h*i/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke();}
  if(netPingSamples.length<2)return;
  const maxV=Math.max(100,Math.max.apply(null,netPingSamples));
  const n=netPingSamples.length;
  const step=w/(NET_MAX_SAMPLES-1);
  const xStart=w-step*(NET_MAX_SAMPLES-n); // 右侧对齐
  ctx.beginPath();
  let lastX=xStart,lastY=0;
  netPingSamples.forEach((v,i)=>{
    const x=xStart+step*i;
    const y=h-(v/maxV)*(h-10)-5;
    if(i===0)ctx.moveTo(x,y);else ctx.lineTo(x,y);
    lastX=x;lastY=y;
  });
  ctx.strokeStyle=NET_PING_COLOR;ctx.lineWidth=2;ctx.lineJoin='round';ctx.stroke();
  // 填充区域
  ctx.lineTo(lastX,h);ctx.lineTo(xStart,h);ctx.closePath();
  ctx.fillStyle='rgba(245,158,11,0.10)';ctx.fill();
}

// ---------- 本机 IP（WebRTC host candidate）----------
// 通过 RTCPeerConnection 收集 ICE candidate，从中解析本机局域网 IP。
// 注意：Safari 等浏览器会用 .local(mDNS) 隐藏真实 IP，此时无法获取。
function getLocalIP(){
  return new Promise(resolve=>{
    let done=false; const finish=v=>{if(!done){done=true;resolve(v);}};
    try{
      const pc=new RTCPeerConnection({iceServers:[]});
      pc.createDataChannel('');
      pc.onicecandidate=e=>{
        if(!e.candidate)return;
        const cand=e.candidate.candidate||'';
        const m=/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/.exec(cand);
        if(m){finish(m[1]);try{pc.close()}catch(_){}}
      };
      pc.createOffer().then(o=>pc.setLocalDescription(o)).catch(()=>finish(null));
      setTimeout(()=>finish(null),2000);
    }catch(e){finish(null);}
  });
}

// ---------- 公网 IP + 地理位置（需联网，失败则跳过）----------
// 使用 ipapi.co 免费接口，支持 CORS；离线 / 被拦截时优雅降级。
async function getPublicIPInfo(){
  try{
    const ctrl=new AbortController();
    const t=setTimeout(()=>ctrl.abort(),4000);
    const res=await fetch('https://ipapi.co/json/',{signal:ctrl.signal});
    clearTimeout(t);
    if(!res.ok)throw new Error('HTTP '+res.status);
    const d=await res.json();
    return {
      ok:true,
      ip:d.ip||'',
      geo:[d.country_name,d.region,d.city].filter(Boolean).join(' · '),
      org:d.org||d.asn||''
    };
  }catch(e){
    return {ok:false, reason:(e&&e.name==='AbortError')?'请求超时 (4s)':((e&&e.message)||'网络错误')};
  }
}

// 加载并填充 IP 地址信息
async function loadNetAddresses(){
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  // 本机局域网 IP
  const local=await getLocalIP();
  set('net-local-ip', local||'无法获取（浏览器未暴露 / 已被 mDNS 隐藏）');
  // 公网 IP + 地理位置
  set('net-public-ip','查询中…');set('net-geo','—');set('net-isp','—');
  const pub=await getPublicIPInfo();
  if(pub.ok){
    set('net-public-ip',pub.ip||'—');
    set('net-geo',pub.geo||'—');
    set('net-isp',pub.org||'—');
  }else{
    set('net-public-ip','无法获取');
    set('net-geo','需联网访问第三方 API（离线或被 CORS 拦截时跳过）');
    set('net-isp','—');
  }
}

// ----------------------------------------------------------------
//  生命周期
// ----------------------------------------------------------------
function startNetworkDetector(){
  updateNetOnline(navigator.onLine!==false);
  readNetConnection();
  loadNetAddresses();   // 异步加载本机/公网 IP 与地理位置
  netOnlineHandler=()=>updateNetOnline(true);
  netOfflineHandler=()=>updateNetOnline(false);
  window.addEventListener('online',netOnlineHandler);
  window.addEventListener('offline',netOfflineHandler);
  const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  if(c){netConnHandler=()=>readNetConnection();c.addEventListener('change',netConnHandler);}
  netPingSamples=[];
  const big=document.getElementById('net-ping-big');
  if(big){big.textContent='测速中…';big.className='net-ping-big';}
  netPingLoop();
}

function stopNetworkDetector(){
  if(netPingTimer){clearTimeout(netPingTimer);netPingTimer=null;}
  if(netOnlineHandler){
    window.removeEventListener('online',netOnlineHandler);
    window.removeEventListener('offline',netOfflineHandler);
    netOnlineHandler=null;netOfflineHandler=null;
  }
  const c=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
  if(c&&netConnHandler)c.removeEventListener('change',netConnHandler);
  netConnHandler=null;
}
