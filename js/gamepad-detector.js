// ================================================================
//  gamepad-detector.js — 手柄检测（肩键 + 摇杆倾斜线）
//  依赖：无（DOM 元素由 index.html 提供）
//  导出（全局）：startGamepadDetector / stopGamepadDetector
// ================================================================

let gamepadInterval=null;
let lastGamepadCount=0;

function buildGamepadSVG(){
  const wrap=document.getElementById('gp-visual');
  wrap.innerHTML=`
  <svg viewBox="0 0 560 280" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <radialGradient id="jBg" cx="50%" cy="50%"><stop offset="0%" stop-color="#2a2d3a"/><stop offset="100%" stop-color="#161822"/></radialGradient>
      <filter id="jGlow"><feGaussianBlur stdDeviation="2.5"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>

    <!-- 肩键：L2(trigger 上) L1(bumper 下) -->
    <rect id="gp-l2" x="38" y="22" width="130" height="20" rx="5" fill="#1a1d27" stroke="#2a2d3a" stroke-width="1.5" class="shoulder-rect"/>
    <rect id="gp-l1" x="38" y="48" width="130" height="16" rx="4" fill="#1e2130" stroke="#2a2d3a" stroke-width="1.5" class="shoulder-rect"/>
    <text x="103" y="36" text-anchor="middle" fill="#4a4f62" font-size="9" font-family="sans-serif">L2 (LT)</text>
    <text x="103" y="60" text-anchor="middle" fill="#4a4f62" font-size="9" font-family="sans-serif">L1 (LB)</text>

    <!-- 肩键：R2(trigger 上) R1(bumper 下) -->
    <rect id="gp-r2" x="392" y="22" width="130" height="20" rx="5" fill="#1a1d27" stroke="#2a2d3a" stroke-width="1.5" class="shoulder-rect"/>
    <rect id="gp-r1" x="392" y="48" width="130" height="16" rx="4" fill="#1e2130" stroke="#2a2d3a" stroke-width="1.5" class="shoulder-rect"/>
    <text x="457" y="36" text-anchor="middle" fill="#4a4f62" font-size="9" font-family="sans-serif">R2 (RT)</text>
    <text x="457" y="60" text-anchor="middle" fill="#4a4f62" font-size="9" font-family="sans-serif">R1 (RB)</text>

    <!-- 左摇杆底板 -->
    <rect x="45" y="82" width="120" height="120" rx="16" fill="url(#jBg)" stroke="#2a2d3a" stroke-width="1.5"/>
    <!-- 右摇杆底板 -->
    <rect x="395" y="82" width="120" height="120" rx="16" fill="url(#jBg)" stroke="#2a2d3a" stroke-width="1.5"/>

    <!-- 左摇杆基准圈 -->
    <circle cx="105" cy="142" r="42" fill="none" stroke="#353849" stroke-width="1" stroke-dasharray="5 4"/>
    <circle cx="105" cy="142" r="22" fill="none" stroke="#2a2d3a" stroke-width="1"/>
    <circle cx="105" cy="142" r="4" fill="#4a4f62"/>

    <!-- 右摇杆基准圈 -->
    <circle cx="455" cy="142" r="42" fill="none" stroke="#353849" stroke-width="1" stroke-dasharray="5 4"/>
    <circle cx="455" cy="142" r="22" fill="none" stroke="#2a2d3a" stroke-width="1"/>
    <circle cx="455" cy="142" r="4" fill="#4a4f62"/>

    <!-- 左摇杆倾斜方向线 -->
    <line id="gp-line-l" x1="105" y1="142" x2="105" y2="142" stroke="#6c8cff" stroke-width="3" filter="url(#jGlow)" class="joystick-line"/>
    <!-- 右摇杆倾斜方向线 -->
    <line id="gp-line-r" x1="455" y1="142" x2="455" y2="142" stroke="#a78bfa" stroke-width="3" filter="url(#jGlow)" class="joystick-line"/>

    <!-- 左摇杆圆心 -->
    <circle id="gp-dot-l" cx="105" cy="142" r="10" fill="#6c8cff" filter="url(#jGlow)"/>
    <!-- 右摇杆圆心 -->
    <circle id="gp-dot-r" cx="455" cy="142" r="10" fill="#a78bfa" filter="url(#jGlow)"/>

    <!-- 标签 -->
    <text x="105" y="218" text-anchor="middle" fill="#6b7084" font-size="11" font-family="sans-serif">左摇杆</text>
    <text x="455" y="218" text-anchor="middle" fill="#6b7084" font-size="11" font-family="sans-serif">右摇杆</text>
    <text x="280" y="130" text-anchor="middle" fill="#4a4f62" font-size="10" font-family="sans-serif">D-Pad · 功能键 · 菜单键</text>
    <text x="280" y="148" text-anchor="middle" fill="#3a3f52" font-size="9" font-family="sans-serif">按钮详情见下方面板</text>

    <!-- 轴值 -->
    <text id="gp-al" x="105" y="240" text-anchor="middle" fill="#9aa0b0" font-size="11" font-family="monospace">X:0.00 Y:0.00</text>
    <text id="gp-ar" x="455" y="240" text-anchor="middle" fill="#9aa0b0" font-size="11" font-family="monospace">X:0.00 Y:0.00</text>
  </svg>`;
}

function pollGamepad(){
  const gamepads=navigator.getGamepads?navigator.getGamepads():[];
  let gp=null;
  for(let i=0;i<gamepads.length;i++){if(gamepads[i]){gp=gamepads[i];break}}

  const connEl=document.getElementById('gp-connection-status');
  const axesPanel=document.getElementById('gp-axes-panel');
  const visualPanel=document.getElementById('gp-visual-panel');

  if(!gp){
    if(lastGamepadCount!==0){connEl.innerHTML='<span style="color:var(--text-muted)">未检测到手柄 · 请连接后按任意键激活</span>';
      document.getElementById('gp-status-dot').className='status-dot idle';document.getElementById('gp-status-text').textContent='未连接';lastGamepadCount=0}
    axesPanel.style.display='none';visualPanel.style.display='none';return;
  }

  if(lastGamepadCount<=0){
    connEl.innerHTML=`<span style="color:var(--green)">已连接: ${gp.id}</span>`;
    document.getElementById('gp-status-dot').className='status-dot active-dot';document.getElementById('gp-status-text').textContent='已连接';
    lastGamepadCount=1;buildGamepadSVG();axesPanel.style.display='';visualPanel.style.display='';
  }

  // 轴值
  const axesC=document.getElementById('gp-axes');
  const axisNames=['左摇杆 X','左摇杆 Y','右摇杆 X','右摇杆 Y'];
  axesC.innerHTML=gp.axes.slice(0,4).map((v,i)=>{
    const pct=((v+1)/2*100).toFixed(1);
    return `<div class="metric"><span class="metric-label">${axisNames[i]||'轴'+i}</span><span class="metric-value">${v.toFixed(4)}</span><div class="axis-bar"><div class="axis-fill" style="width:${pct}%"></div></div></div>`;
  }).join('');

  // 按钮
  const btnNames=['A','B','X','Y','LB','RB','LT','RT','Back','Start','L3','R3','↑','↓','←','→'];
  document.getElementById('gp-buttons').innerHTML=gp.buttons.slice(0,16).map((btn,i)=>
    `<div class="gbtn${btn.pressed?' pressed':''}"><span>${btnNames[i]||'B'+i}</span><span class="gbtn-val">${btn.value.toFixed(2)}</span></div>`).join('');

  // 摇杆可视化
  const maxR=40;
  const ax0=gp.axes[0]||0,ax1=gp.axes[1]||0,ax2=gp.axes[2]||0,ax3=gp.axes[3]||0;
  const lx=105+ax0*maxR,ly=142+ax1*maxR,rx=455+ax2*maxR,ry=142+ax3*maxR;

  const lineL=document.getElementById('gp-line-l');if(lineL){lineL.setAttribute('x2',lx);lineL.setAttribute('y2',ly)}
  const dotL=document.getElementById('gp-dot-l');if(dotL){dotL.setAttribute('cx',lx);dotL.setAttribute('cy',ly)}
  const lineR=document.getElementById('gp-line-r');if(lineR){lineR.setAttribute('x2',rx);lineR.setAttribute('y2',ry)}
  const dotR=document.getElementById('gp-dot-r');if(dotR){dotR.setAttribute('cx',rx);dotR.setAttribute('cy',ry)}

  const labelL=document.getElementById('gp-al');if(labelL)labelL.textContent=`X:${ax0.toFixed(2)} Y:${ax1.toFixed(2)}`;
  const labelR=document.getElementById('gp-ar');if(labelR)labelR.textContent=`X:${ax2.toFixed(2)} Y:${ax3.toFixed(2)}`;

  // 肩键 L1/B4 L2/B6 R1/B5 R2/B7
  function setShoulder(id,bIdx,color){const el=document.getElementById(id);if(!el)return;const btn=gp.buttons[bIdx];
    if(btn&&btn.value>0.05){el.setAttribute('fill',color);el.setAttribute('stroke',color);el.setAttribute('stroke-width','2')}
    else{el.setAttribute('fill','#1a1d27');el.setAttribute('stroke','#2a2d3a');el.setAttribute('stroke-width','1.5')}}
  setShoulder('gp-l2',6,'#f87171');setShoulder('gp-l1',4,'#f87171');
  setShoulder('gp-r2',7,'#f87171');setShoulder('gp-r1',5,'#f87171');
}

function startGamepadDetector(){
  document.getElementById('gp-status-dot').className='status-dot idle';document.getElementById('gp-status-text').textContent='检测中';
  document.getElementById('gp-connection-status').innerHTML='<span style="color:var(--text-muted)">正在检测手柄连接...</span>';
  document.getElementById('gp-axes-panel').style.display='none';document.getElementById('gp-visual-panel').style.display='none';
  lastGamepadCount=-1;gamepadInterval=setInterval(pollGamepad,50);
}
function stopGamepadDetector(){if(gamepadInterval){clearInterval(gamepadInterval);gamepadInterval=null}}
