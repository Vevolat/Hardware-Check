// ================================================================
//  mouse-detector.js — 鼠标检测
//  依赖：无（DOM 元素由 index.html 提供）
//  导出（全局）：startMouseDetector / stopMouseDetector
// ================================================================

let mouseState={pageX:0,pageY:0,clientX:0,clientY:0,left:!1,middle:!1,right:!1,scrollDelta:0,scrollDir:'—',clickCount:0,moveCount:0};

function handleMouseMove(e){
  mouseState.pageX=e.pageX;mouseState.pageY=e.pageY;
  mouseState.clientX=e.clientX;mouseState.clientY=e.clientY;
  mouseState.moveCount++;updateMouseUI();
  const z=document.getElementById('mouse-track-zone');
  if(z){const r=z.getBoundingClientRect(),rx=e.clientX-r.left,ry=e.clientY-r.top;
    if(rx>=0&&ry>=0&&rx<=r.width&&ry<=r.height){
      document.getElementById('crosshair-h').style.top=ry+'px';
      document.getElementById('crosshair-v').style.left=rx+'px';
      document.getElementById('coord-tip').style.left=rx+'px';
      document.getElementById('coord-tip').style.top=ry+'px';
      document.getElementById('coord-tip').textContent=`X: ${Math.round(rx)}, Y: ${Math.round(ry)}`;
      document.querySelector('.track-hint').style.display='none';
      document.getElementById('mouse-status-dot').className='status-dot active-dot';
      document.getElementById('mouse-status-text').textContent='活动';
    }
  }
}
function handleMouseDown(e){
  if(e.button===0){mouseState.left=!0;mouseState.clickCount++}
  else if(e.button===1)mouseState.middle=!0;
  else if(e.button===2)mouseState.right=!0;
  updateMouseUI();
  const z=document.getElementById('mouse-track-zone');
  if(z){const r=z.getBoundingClientRect(),rip=document.createElement('div');
    rip.className='click-ripple';rip.style.left=(e.clientX-r.left)+'px';rip.style.top=(e.clientY-r.top)+'px';
    z.appendChild(rip);setTimeout(()=>rip.remove(),600)}
}
function handleMouseUp(e){
  if(e.button===0)mouseState.left=!1;
  else if(e.button===1)mouseState.middle=!1;
  else if(e.button===2)mouseState.right=!1;
  updateMouseUI();
}
function handleWheel(e){mouseState.scrollDelta=e.deltaY;mouseState.scrollDir=e.deltaY>0?'↓ 向下':e.deltaY<0?'↑ 向上':'—';updateMouseUI()}
function updateMouseUI(){
  const g=id=>document.getElementById(id);
  if(!g('m-page-x'))return;
  g('m-page-x').textContent=mouseState.pageX;g('m-page-y').textContent=mouseState.pageY;
  g('m-client-x').textContent=mouseState.clientX;g('m-client-y').textContent=mouseState.clientY;
  g('m-scroll-dir').textContent=mouseState.scrollDir;g('m-scroll-delta').textContent=mouseState.scrollDelta;
  g('m-click-count').textContent=mouseState.clickCount;g('m-move-count').textContent=mouseState.moveCount;
  ['ind-left','ind-middle','ind-right'].forEach((id,i)=>{const el=g(id);if(!el)return;(i===0?mouseState.left:i===1?mouseState.middle:mouseState.right)?el.classList.add('active'):el.classList.remove('active')})
}
function startMouseDetector(){
  document.addEventListener('mousemove',handleMouseMove);document.addEventListener('mousedown',handleMouseDown);
  document.addEventListener('mouseup',handleMouseUp);document.addEventListener('wheel',handleWheel,{passive:!0});
  document.getElementById('mouse-status-dot').className='status-dot idle';document.getElementById('mouse-status-text').textContent='待机';
}
function stopMouseDetector(){
  document.removeEventListener('mousemove',handleMouseMove);document.removeEventListener('mousedown',handleMouseDown);
  document.removeEventListener('mouseup',handleMouseUp);document.removeEventListener('wheel',handleWheel);
}
