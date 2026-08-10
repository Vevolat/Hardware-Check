// ================================================================
//  hardware-detector.js — 硬件配置列表
//  模块级局部变量（避免污染全局），仅 start/stop 暴露到全局
//  依赖：无（纯浏览器 API）
//  导出（全局）：
//    startHardwareDetector / stopHardwareDetector
// ================================================================

let hwBatteryObj=null;        // BatteryManager 实例
let hwBatteryHandler=null;    // 电池状态变化回调

// ---------- 解析 User-Agent ----------
function detectOS(ua){
  if(/Windows NT 10/.test(ua))return 'Windows 10 / 11';
  if(/Windows NT 6\.3/.test(ua))return 'Windows 8.1';
  if(/Windows NT/.test(ua))return 'Windows';
  if(/Mac OS X/.test(ua))return 'macOS';
  if(/Android/.test(ua))return 'Android';
  if(/iPhone|iPad|iPod/.test(ua))return 'iOS';
  if(/CrOS/.test(ua))return 'ChromeOS';
  if(/Linux/.test(ua))return 'Linux';
  return '未知';
}
function detectBrowser(ua){
  if(/Edg\//.test(ua))return 'Edge';
  if(/OPR\/|Opera/.test(ua))return 'Opera';
  if(/Firefox\//.test(ua))return 'Firefox';
  if(/Chrome\//.test(ua))return 'Chrome';
  if(/Safari\//.test(ua))return 'Safari';
  return '未知';
}

// ---------- 多显卡检测（WebGL + WebGPU 双路枚举） ----------
function guessGpuType(name){
  const n=String(name).toLowerCase();
  if(/intel|uhd|iris|hd graphics|apple|mali|adreno|powervr|swiftshader|llvmpipe|microsoft basic|llvm/.test(n))return '集成显卡';
  if(/nvidia|geforce|rtx|gtx|quadro|radeon|amd|rx |vega|arc/.test(n))return '独立显卡';
  return '未知类型';
}

function escapeHtml(s){
  if(!s)return'';
  return String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
}

// 枚举所有可用 GPU：WebGL 给出当前渲染器，WebGPU 通过不同功耗偏好枚举多块
async function detectGPUs(){
  const gpus=[];
  // 1) WebGL —— 当前使用的渲染器
  try{
    const canvas=document.createElement('canvas');
    const gl=canvas.getContext('webgl')||canvas.getContext('experimental-webgl');
    if(gl){
      const dbg=gl.getExtension('WEBGL_debug_renderer_info');
      const name=dbg?gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
      if(name)gpus.push({name:String(name),source:'WebGL',type:guessGpuType(name)});
    }
  }catch(e){}
  // 2) WebGPU —— 通过 low-power / high-performance 枚举核显与独显
  if(navigator.gpu){
    try{
      const specs=[
        {pref:'low-power',label:'集成显卡（低功耗）'},
        {pref:'high-performance',label:'独立显卡（高性能）'}
      ];
      for(const s of specs){
        let adp=null;
        try{adp=await navigator.gpu.requestAdapter({powerPreference:s.pref});}catch(e){}
        if(!adp)continue;
        let info=null;
        try{info=adp.info||(adp.requestAdapterInfo&&await adp.requestAdapterInfo())||null;}catch(e){}
        const vendor=info&&info.vendor?info.vendor:'';
        const desc=info&&(info.description||info.title)?(info.description||info.title):'WebGPU 适配器';
        const name=(vendor&&desc&&desc!==vendor)?(vendor+' · '+desc):desc;
        const limits=adp.limits?{
          maxBufferSize:adp.limits.maxBufferSize,
          maxStorage:adp.limits.maxStorageBufferBindingSize
        }:null;
        // 与已检测到的同名 GPU 视为同一块，避免重复
        if(!gpus.some(g=>g.name===name)){
          gpus.push({name,source:'WebGPU',type:s.label,limits});
        }
      }
    }catch(e){}
  }
  if(gpus.length===0)gpus.push({name:'未检测到 GPU 信息',source:'',type:''});
  return gpus;
}

// 渲染显卡列表（支持多块）
async function renderGPUs(){
  const list=document.getElementById('hw-gpu-list');
  const countEl=document.getElementById('hw-gpu-count');
  if(countEl)countEl.textContent='0';
  if(!list)return;
  const gpus=await detectGPUs();
  if(countEl)countEl.textContent=String(gpus.length);
  list.innerHTML='';
  gpus.forEach(g=>{
    const card=document.createElement('div');
    card.className='hw-gpu-card';
    let meta=(g.type?('类型：'+g.type+'　'):'')+(g.source?('来源：'+g.source):'');
    let vram='<div class="hw-gpu-meta">显存 (VRAM)：浏览器无法读取（安全限制）</div>';
    if(g.limits){
      const gb=(g.limits.maxBufferSize/1073741824).toFixed(1);
      vram+='<div class="hw-gpu-meta">缓冲区上限 ≈ '+gb+' GB（WebGPU 限制，非真实显存）</div>';
    }
    card.innerHTML='<div class="hw-gpu-name">'+escapeHtml(g.name)+'</div>'+
      (meta?'<div class="hw-gpu-meta">'+escapeHtml(meta)+'</div>':'')+vram;
    list.appendChild(card);
  });
}

// ---------- 存储信息（站点配额，作为硬盘信息的替代） ----------
async function loadStorage(){
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  if(navigator.storage&&navigator.storage.estimate){
    try{
      const est=await navigator.storage.estimate();
      const used=((est.usage||0)/1073741824).toFixed(2);
      const quota=((est.quota||0)/1073741824).toFixed(2);
      set('hw-storage-usage',used+' GB');
      set('hw-storage-quota',quota+' GB');
    }catch(e){set('hw-storage-usage','读取失败');set('hw-storage-quota','—');}
  }else{set('hw-storage-usage','不支持');set('hw-storage-quota','—');}
}

// ---------- 更多配置信息 ----------
function renderMoreConfig(){
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  // 时区
  let tz='未知';
  try{tz=Intl.DateTimeFormat().resolvedOptions().timeZone||'未知';}catch(e){}
  set('hw-tz',tz);
  // CPU 架构
  let arch='未知';
  if(navigator.userAgentData&&navigator.userAgentData.architecture)arch=navigator.userAgentData.architecture+' 位';
  set('hw-arch',arch);
  // 色彩空间
  let gamut='未知';
  if(window.matchMedia){
    if(matchMedia('(color-gamut: rec2020)').matches)gamut='Rec.2020（广色域）';
    else if(matchMedia('(color-gamut: p3)').matches)gamut='Display P3';
    else if(matchMedia('(color-gamut: srgb)').matches)gamut='sRGB';
  }
  set('hw-color-gamut',gamut);
  set('hw-pixel-depth',screen.pixelDepth+' bit');
  // 移动设备
  if(navigator.userAgentData&&typeof navigator.userAgentData.mobile==='boolean'){
    set('hw-mobile',navigator.userAgentData.mobile?'是':'否');
  }else set('hw-mobile','未知');
  // UA Brands
  if(navigator.userAgentData&&navigator.userAgentData.brands&&navigator.userAgentData.brands.length){
    set('hw-ua-brands',navigator.userAgentData.brands.map(b=>b.brand+' '+b.version).join(' / '));
  }else set('hw-ua-brands','未知（UA-CH 不可用）');
  // 屏幕方向
  set('hw-orientation',(screen.orientation&&screen.orientation.type)||(window.orientation!=null?('rotate '+window.orientation):'未知'));
}

// ---------- 能力支持清单 ----------
function renderHwCapabilities(){
  const wrap=document.getElementById('hw-capabilities');
  if(!wrap)return;
  const webglOk=(()=>{try{const c=document.createElement('canvas');return !!(c.getContext('webgl')||c.getContext('experimental-webgl'));}catch(e){return false;}})();
  const canvas2dOk=(()=>{try{const c=document.createElement('canvas');return !!c.getContext('2d');}catch(e){return false;}})();
  const caps=[
    ['WebGL', webglOk],
    ['Web Audio', typeof (window.AudioContext||window.webkitAudioContext)==='function'],
    ['Canvas 2D', canvas2dOk],
    ['WebAssembly', typeof WebAssembly==='object'],
    ['WebRTC', !!(navigator.mediaDevices&&navigator.mediaDevices.getUserMedia)],
    ['Service Worker', 'serviceWorker' in navigator],
    ['Web Bluetooth', 'bluetooth' in navigator],
    ['Touch', (navigator.maxTouchPoints||0)>0],
  ];
  wrap.innerHTML='';
  caps.forEach(([name,ok])=>{
    const chip=document.createElement('span');
    chip.className='hw-cap-chip '+(ok?'supported':'unsupported');
    chip.innerHTML='<span class="dot"></span>'+name+(ok?'':' · 不支持');
    wrap.appendChild(chip);
  });
}

// ---------- 电池 ----------
function loadBattery(){
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  if(!navigator.getBattery){set('hw-battery-level','不支持');set('hw-battery-charging','—');return;}
  navigator.getBattery().then(b=>{
    hwBatteryObj=b;
    const upd=()=>{
      set('hw-battery-level',Math.round(b.level*100)+'%');
      set('hw-battery-charging',b.charging?'充电中':'未充电');
    };
    upd();
    hwBatteryHandler=upd;
    b.addEventListener('levelchange',upd);
    b.addEventListener('chargingchange',upd);
  }).catch(()=>{set('hw-battery-level','读取失败');set('hw-battery-charging','—');});
}

// ----------------------------------------------------------------
//  生命周期
// ----------------------------------------------------------------
function startHardwareDetector(){
  const set=(id,v)=>{const el=document.getElementById(id);if(el)el.textContent=v;};
  // 处理器 / 内存
  set('hw-cpu-cores', navigator.hardwareConcurrency ? navigator.hardwareConcurrency+' 核' : '未知');
  set('hw-memory', navigator.deviceMemory ? navigator.deviceMemory+' GB（约）' : '未知');
  set('hw-platform', navigator.platform||'未知');
  // 显示
  set('hw-screen', screen.width+' × '+screen.height);
  set('hw-dpr', (window.devicePixelRatio||1).toFixed(2));
  set('hw-color-depth', screen.colorDepth+' bit');
  set('hw-touch', String(navigator.maxTouchPoints||0));
  // 浏览器 / 系统
  const ua=navigator.userAgent||'';
  set('hw-browser', detectBrowser(ua));
  set('hw-os', detectOS(ua));
  set('hw-lang', (navigator.languages&&navigator.languages.join(', '))||navigator.language||'未知');
  set('hw-ua', ua);
  // GPU（多显卡枚举）
  renderGPUs();
  // 存储 / 更多配置 / 能力 / 电池
  loadStorage();
  renderMoreConfig();
  renderHwCapabilities();
  loadBattery();
}

function stopHardwareDetector(){
  if(hwBatteryObj&&hwBatteryHandler){
    hwBatteryObj.removeEventListener('levelchange',hwBatteryHandler);
    hwBatteryObj.removeEventListener('chargingchange',hwBatteryHandler);
  }
  hwBatteryObj=null;hwBatteryHandler=null;
}
