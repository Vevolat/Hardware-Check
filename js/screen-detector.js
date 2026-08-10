// ================================================================
//  screen-detector.js — 屏幕检测
//    屏幕信息 / 刷新率检测 / 刷新率对比动画 / 全屏颜色检测
//  依赖：无（DOM 元素由 index.html 提供）
//  导出（全局）：updateScreenInfo / detectRefreshRate /
//               startRefreshAnims / stopRefreshAnims /
//               goFullscreenColorTest / cycleFullscreenColor /
//               exitFullscreenColorTest / setColorTest / startGradientTest
// ================================================================

// ----------------------------------------------------------------
//  屏幕信息
// ----------------------------------------------------------------
function updateScreenInfo(){
  const dpr=window.devicePixelRatio||1;
  // 物理分辨率 = 屏幕逻辑尺寸 × 设备像素比(DPR)
  document.getElementById('sc-resolution').textContent=`${screen.width}×${screen.height}（物理: ${Math.round(screen.width*dpr)}×${Math.round(screen.height*dpr)}）`;
  // 可用区域 = 逻辑像素（不减DPR，这是可用的CSS像素区域）
  document.getElementById('sc-avail').textContent=`${screen.availWidth}×${screen.availHeight}`;
  document.getElementById('sc-dpr').textContent=dpr.toFixed(1);
  document.getElementById('sc-color-depth').textContent=screen.colorDepth+' bit';
  document.getElementById('sc-window').textContent=`${window.innerWidth}×${window.innerHeight}`;
  document.getElementById('sc-orientation').textContent=screen.orientation?screen.orientation.type:'N/A';
  const hasTouch='ontouchstart' in window||navigator.maxTouchPoints>0;
  document.getElementById('sc-touch').textContent=hasTouch?'支持 (点数: '+(navigator.maxTouchPoints||'?')+')':'不支持';
  document.getElementById('sc-touch').style.color=hasTouch?'var(--green)':'var(--text-muted)';
  document.getElementById('sc-pixel-ratio-desc').textContent=`${Math.round(screen.width*dpr)}:${screen.width} = ${dpr.toFixed(1)}:1`;
}

// ----------------------------------------------------------------
//  刷新率检测 — 多帧采样
// ----------------------------------------------------------------
let detectedHz=60;
function detectRefreshRate(){
  return new Promise(resolve=>{
    const samples=[];let lastTime=performance.now();
    function sample(t){
      const dt=t-lastTime;lastTime=t;
      if(dt>0&&dt<200)samples.push(1000/dt);
      if(samples.length>=120){
        // 取中位附近样本，排除极端值
        const sorted=[...samples].sort((a,b)=>a-b);
        const trimmed=sorted.slice(10,-10); // 去掉头尾10个样本
        const avg=trimmed.reduce((a,b)=>a+b,0)/trimmed.length;
        // 圆整到常见刷新率
        const commonHz=[24,30,48,50,60,72,75,90,100,120,144,165,180,200,240,300,360];
        let hz=60;
        for(const c of commonHz){if(Math.abs(avg-c)<Math.abs(avg-hz))hz=c}
        detectedHz=hz;
        document.getElementById('sc-refresh-rate').textContent=hz+' Hz';
        document.getElementById('sc-refresh-rate').style.color='var(--green)';
        document.getElementById('native-hz-label').textContent=hz+' fps (本机)';
        resolve(hz);return;
      }
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  });
}

// ----------------------------------------------------------------
//  刷新率对比动画 — testufo 风格
//  垂直条纹背景 + 移动物体，通过不同帧率展示流畅度差异
// ----------------------------------------------------------------
let rafId=null;

function initCanvas(canvasId){
  const canvas=document.getElementById(canvasId);
  if(!canvas)return null;
  const ctx=canvas.getContext('2d');
  return{
    canvas,ctx,x:0,
    resize(){
      const rect=canvas.getBoundingClientRect();
      const w=rect.width,h=rect.height;
      const dpr=window.devicePixelRatio||1;
      if(canvas.width!==Math.round(w*dpr)||canvas.height!==Math.round(h*dpr)){
        canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
        ctx.setTransform(dpr,0,0,dpr,0,0);
      }
      return{w,h};
    }
  };
}

function drawTestUFOStyleFrame(ctx,w,h,x){
  // 暗色背景
  ctx.fillStyle='#1a1a2e';ctx.fillRect(0,0,w,h);

  // 垂直条纹背景 — testufo 标志性的栅栏效果
  var stripeW=8,gap=6,stripeStep=stripeW+gap;
  ctx.fillStyle='rgba(255,255,255,.06)';
  for(var sx=-((x%stripeStep)|0);sx<w+stripeStep;sx+=stripeStep){
    ctx.fillRect(sx,0,stripeW,h);
  }

  // 中心参考线
  ctx.strokeStyle='rgba(255,255,255,.08)';ctx.lineWidth=1;
  ctx.beginPath();ctx.moveTo(0,h/2);ctx.lineTo(w,h/2);ctx.stroke();

  // 移动的 UFO —— 由多层组成
  var cx=x%w,cy=h/2;

  // 主体（梭形/碟形）
  ctx.save();
  ctx.translate(cx,cy);
  ctx.beginPath();
  ctx.ellipse(0,0,22,10,0,0,Math.PI*2);
  var bodyGrad=ctx.createLinearGradient(0,-10,0,10);
  bodyGrad.addColorStop(0,'#6c8cff');bodyGrad.addColorStop(.5,'#3b5fd9');bodyGrad.addColorStop(1,'#1a3a8a');
  ctx.fillStyle=bodyGrad;ctx.fill();
  ctx.strokeStyle='rgba(255,255,255,.3)';ctx.lineWidth=1.5;ctx.stroke();

  // 穹顶
  ctx.beginPath();ctx.ellipse(0,-2,13,8,0,Math.PI,0);
  var domeGrad=ctx.createLinearGradient(0,-10,0,0);
  domeGrad.addColorStop(0,'rgba(255,255,255,.5)');domeGrad.addColorStop(1,'rgba(108,140,255,.6)');
  ctx.fillStyle=domeGrad;ctx.fill();

  // 亮点
  ctx.beginPath();ctx.arc(-5,-5,3,0,Math.PI*2);
  ctx.fillStyle='rgba(255,255,255,.7)';ctx.fill();

  ctx.restore();

  // 速度刻度
  ctx.fillStyle='rgba(255,255,255,.08)';ctx.font='9px monospace';ctx.textAlign='center';
  for(var i=0;i<w;i+=stripeStep*4){
    ctx.fillRect(i,h-8,1,8);
  }
}

function startRefreshAnims(){
  stopRefreshAnims();
  var a30=initCanvas('canvas-30hz'),a60=initCanvas('canvas-60hz'),aN=initCanvas('canvas-native');
  if(!a30||!a60||!aN)return;

  var speed=180; // 像素/秒 — 三个动画速度相同
  var lastTime=performance.now();
  var lastUpdate30=lastTime,lastUpdate60=lastTime;
  var interval30=1000/30,interval60=1000/60;

  function drawObj(obj){
    var dims=obj.resize();
    var w=dims.w,h=dims.h;
    if(!w||!h)return;
    drawTestUFOStyleFrame(obj.ctx,w,h,obj.x);
  }

  function loop(now){
    var dt=now-lastTime;
    lastTime=now;

    // 30fps: 只在间隔到达时更新位置（产生跳跃感）
    if(now-lastUpdate30>=interval30){
      var updateDt=now-lastUpdate30;
      a30.x+=speed*(updateDt/1000);
      var w30=a30.resize().w;
      if(a30.x>w30+60)a30.x=-60;
      lastUpdate30=now;
    }

    // 60fps: 每 ~16.7ms 更新位置
    if(now-lastUpdate60>=interval60){
      var updateDt6=now-lastUpdate60;
      a60.x+=speed*(updateDt6/1000);
      var w60=a60.resize().w;
      if(a60.x>w60+60)a60.x=-60;
      lastUpdate60=now;
    }

    // 本机: 每帧更新位置（最顺滑）
    aN.x+=speed*(dt/1000);
    var wN=aN.resize().w;
    if(aN.x>wN+60)aN.x=-60;

    // 三个 canvas 每帧都绘制（让用户看到 30fps 的跳跃效果）
    drawObj(a30);drawObj(a60);drawObj(aN);

    rafId=requestAnimationFrame(loop);
  }
  rafId=requestAnimationFrame(loop);
}

function stopRefreshAnims(){
  if(rafId){cancelAnimationFrame(rafId);rafId=null}
}

// ----------------------------------------------------------------
//  全屏颜色检测
// ----------------------------------------------------------------
const colorSequence=['#ffffff','#000000','#ff0000','#00ff00','#0000ff','#ffff00','#00ffff','#ff00ff','#808080'];

function goFullscreenColorTest(){
  const el=document.documentElement;
  if(el.requestFullscreen)el.requestFullscreen();else if(el.webkitRequestFullscreen)el.webkitRequestFullscreen();
  document.body.classList.add('no-scroll');
  const overlay=document.getElementById('fullscreen-overlay');
  overlay.classList.add('show');
  const area=document.getElementById('color-test-area');
  const bg=area?area.style.backgroundColor:'#000000';
  overlay.style.backgroundColor=bg;
  window._fsIdx=colorSequence.findIndex(c=>c.toLowerCase()===rgbToHex(bg).toLowerCase());
  if(window._fsIdx<0)window._fsIdx=0;
}

function cycleFullscreenColor(){
  const overlay=document.getElementById('fullscreen-overlay');
  if(!overlay.classList.contains('show'))return;
  window._fsIdx=((window._fsIdx||0)+1)%colorSequence.length;
  overlay.style.backgroundColor=colorSequence[window._fsIdx];
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.toggle('active',s.dataset.color.toLowerCase()===colorSequence[window._fsIdx].toLowerCase()));
}

function exitFullscreenColorTest(){
  document.getElementById('fullscreen-overlay').classList.remove('show');
  document.body.classList.remove('no-scroll');
}

function setColorTest(color){
  document.getElementById('color-test-area').style.backgroundColor=color;
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.toggle('active',s.dataset.color.toLowerCase()===color.toLowerCase()));
  const overlay=document.getElementById('fullscreen-overlay');
  if(overlay.classList.contains('show')){overlay.style.backgroundColor=color;
    window._fsIdx=colorSequence.findIndex(c=>c.toLowerCase()===color.toLowerCase());if(window._fsIdx<0)window._fsIdx=0}
}

function startGradientTest(){
  const area=document.getElementById('color-test-area');
  area.style.background='linear-gradient(135deg,#f00,#f80,#ff0,#0f0,#0ff,#00f,#80f,#f0f)';
  document.querySelectorAll('.color-swatch').forEach(s=>s.classList.remove('active'));
}

function rgbToHex(rgb){
  if(!rgb||rgb==='transparent')return'#000000';
  if(rgb.startsWith('#'))return rgb;
  const m=rgb.match(/[\d.]+/g);if(!m||m.length<3)return'#000000';
  return'#'+m.slice(0,3).map(x=>parseInt(x).toString(16).padStart(2,'0')).join('');
}

// 全屏 / 窗口尺寸变化监听
document.addEventListener('fullscreenchange',()=>{if(!document.fullscreenElement)exitFullscreenColorTest()});
document.addEventListener('webkitfullscreenchange',()=>{if(!document.webkitFullscreenElement)exitFullscreenColorTest()});

window.addEventListener('resize',()=>{
  if(document.getElementById('screen-page').classList.contains('active'))updateScreenInfo();
});
