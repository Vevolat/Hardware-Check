// ================================================================
//  keyboard-detector.js — 键盘检测（108 键全键盘 · 三区布局）
//  依赖：无（DOM 元素由 index.html 提供）
//  导出（全局）：startKeyboardDetector / stopKeyboardDetector
// ================================================================

const pressedKeyCodes=new Set();
const keyHistoryList=[];
const MAX_KH=60;

// 功能键行 (Esc + F1~F12)
const kbFuncRow=[
  {l:'Esc',c:'Escape',w:1},{l:'',c:'',w:0.5},
  {l:'F1',c:'F1',w:1},{l:'F2',c:'F2',w:1},{l:'F3',c:'F3',w:1},{l:'F4',c:'F4',w:1},
  {l:'',c:'',w:0.5},{l:'F5',c:'F5',w:1},{l:'F6',c:'F6',w:1},{l:'F7',c:'F7',w:1},{l:'F8',c:'F8',w:1},
  {l:'',c:'',w:0.5},{l:'F9',c:'F9',w:1},{l:'F10',c:'F10',w:1},{l:'F11',c:'F11',w:1},{l:'F12',c:'F12',w:1},
];
// 功能键行右侧导航区 (PrtSc ScrLk Pause)
const kbNavFunc=[
  {l:'PrtSc',c:'PrintScreen'},{l:'ScrLk',c:'ScrollLock'},{l:'Pause',c:'Pause'},
];
// 主键区 5 行
const kbMain=[
  [
    {l:'`',c:'Backquote'},{l:'1',c:'Digit1'},{l:'2',c:'Digit2'},{l:'3',c:'Digit3'},
    {l:'4',c:'Digit4'},{l:'5',c:'Digit5'},{l:'6',c:'Digit6'},{l:'7',c:'Digit7'},
    {l:'8',c:'Digit8'},{l:'9',c:'Digit9'},{l:'0',c:'Digit0'},{l:'-',c:'Minus'},
    {l:'=',c:'Equal'},{l:'Bksp',c:'Backspace',w:2},
  ],
  [
    {l:'Tab',c:'Tab',w:1.5},{l:'Q',c:'KeyQ'},{l:'W',c:'KeyW'},{l:'E',c:'KeyE'},
    {l:'R',c:'KeyR'},{l:'T',c:'KeyT'},{l:'Y',c:'KeyY'},{l:'U',c:'KeyU'},
    {l:'I',c:'KeyI'},{l:'O',c:'KeyO'},{l:'P',c:'KeyP'},{l:'[',c:'BracketLeft'},
    {l:']',c:'BracketRight'},{l:'\\',c:'Backslash',w:1.5},
  ],
  [
    {l:'Caps',c:'CapsLock',w:1.75},{l:'A',c:'KeyA'},{l:'S',c:'KeyS'},{l:'D',c:'KeyD'},
    {l:'F',c:'KeyF'},{l:'G',c:'KeyG'},{l:'H',c:'KeyH'},{l:'J',c:'KeyJ'},
    {l:'K',c:'KeyK'},{l:'L',c:'KeyL'},{l:';',c:'Semicolon'},{l:"'",c:'Quote'},
    {l:'Enter',c:'Enter',w:2.25},
  ],
  [
    {l:'Shift',c:'ShiftLeft',w:2.25},{l:'Z',c:'KeyZ'},{l:'X',c:'KeyX'},{l:'C',c:'KeyC'},
    {l:'V',c:'KeyV'},{l:'B',c:'KeyB'},{l:'N',c:'KeyN'},{l:'M',c:'KeyM'},
    {l:',',c:'Comma'},{l:'.',c:'Period'},{l:'/',c:'Slash'},{l:'Shift',c:'ShiftRight',w:2.75},
  ],
  [
    {l:'Ctrl',c:'ControlLeft',w:1.25},{l:'Win',c:'MetaLeft',w:1.25},{l:'Alt',c:'AltLeft',w:1.25},
    {l:'',c:'Space',w:6.25},
    {l:'Alt',c:'AltRight',w:1.25},{l:'Win',c:'MetaRight',w:1.25},{l:'Menu',c:'ContextMenu',w:1.25},{l:'Ctrl',c:'ControlRight',w:1.25},
  ],
];
// 导航区 5 行 (与主键区行对齐)
const kbNav=[
  [{l:'Ins',c:'Insert'},{l:'Home',c:'Home'},{l:'PgUp',c:'PageUp'}],
  [{l:'Del',c:'Delete'},{l:'End',c:'End'},{l:'PgDn',c:'PageDown'}],
  [{l:'',c:''},{l:'',c:''},{l:'',c:''}],
  [{l:'',c:''},{l:'↑',c:'ArrowUp'},{l:'',c:''}],
  [{l:'←',c:'ArrowLeft'},{l:'↓',c:'ArrowDown'},{l:'→',c:'ArrowRight'}],
];
// 小键盘区 (CSS grid，显式定位)
const kbNumpad=[
  {l:'NumLk',c:'NumLock',gr:'1',gc:'1'},
  {l:'/',c:'NumpadDivide',gr:'1',gc:'2'},
  {l:'*',c:'NumpadMultiply',gr:'1',gc:'3'},
  {l:'-',c:'NumpadSubtract',gr:'1',gc:'4'},
  {l:'7',c:'Numpad7',gr:'2',gc:'1'},
  {l:'8',c:'Numpad8',gr:'2',gc:'2'},
  {l:'9',c:'Numpad9',gr:'2',gc:'3'},
  {l:'+',c:'NumpadAdd',gr:'2/4',gc:'4'},
  {l:'4',c:'Numpad4',gr:'3',gc:'1'},
  {l:'5',c:'Numpad5',gr:'3',gc:'2'},
  {l:'6',c:'Numpad6',gr:'3',gc:'3'},
  {l:'1',c:'Numpad1',gr:'4',gc:'1'},
  {l:'2',c:'Numpad2',gr:'4',gc:'2'},
  {l:'3',c:'Numpad3',gr:'4',gc:'3'},
  {l:'Enter',c:'NumpadEnter',gr:'4/6',gc:'4'},
  {l:'0',c:'Numpad0',gr:'5',gc:'1/3'},
  {l:'.',c:'NumpadDecimal',gr:'5',gc:'3'},
];

let keyElMap={};

function getWClass(w){
  if(!w||w===1)return'';
  if(w>=6.25)return'w625';
  if(w>=6)return'w6';
  if(w>=2.75)return'w275';
  if(w>=2.25)return'w225';
  if(w>=2)return'w2';
  if(w>=1.75)return'w175';
  if(w>=1.5)return'w15';
  return'';
}

function buildKeyboardUI(){
  const container=document.getElementById('kb-layout');
  keyElMap={};
  var html='';

  // 功能键行
  html+='<div class="kb-func-row"><div class="kb-func-main">';
  kbFuncRow.forEach(function(k){
    if(!k.c){html+='<div class="key-key spacer" style="min-width:'+((k.w||0.5)*38)+'px"></div>';return}
    html+='<span class="key-key '+getWClass(k.w)+'" data-code="'+k.c+'">'+k.l+'</span>';
  });
  html+='</div><div class="kb-func-nav">';
  kbNavFunc.forEach(function(k){
    html+='<span class="key-key" data-code="'+k.c+'">'+k.l+'</span>';
  });
  html+='</div></div>';

  // 主体三区
  html+='<div class="kb-body">';

  // 主键区
  html+='<div class="kb-main">';
  kbMain.forEach(function(row){
    html+='<div class="key-row">';
    row.forEach(function(k){
      if(!k.c){html+='<div class="key-key spacer" style="min-width:'+((k.w||0.5)*38)+'px"></div>';return}
      html+='<span class="key-key '+getWClass(k.w)+'" data-code="'+k.c+'">'+k.l+'</span>';
    });
    html+='</div>';
  });
  html+='</div>';

  // 导航区
  html+='<div class="kb-nav">';
  kbNav.forEach(function(row){
    html+='<div class="kb-nav-row">';
    row.forEach(function(k){
      if(!k.c){html+='<div class="key-key spacer"></div>';return}
      html+='<span class="key-key" data-code="'+k.c+'">'+k.l+'</span>';
    });
    html+='</div>';
  });
  html+='</div>';

  // 小键盘区
  html+='<div class="kb-numpad">';
  kbNumpad.forEach(function(k){
    html+='<span class="key-key" data-code="'+k.c+'" style="grid-row:'+k.gr+';grid-column:'+k.gc+'">'+k.l+'</span>';
  });
  html+='</div>';

  html+='</div>';
  container.innerHTML=html;
  container.querySelectorAll('.key-key[data-code]').forEach(function(el){keyElMap[el.dataset.code]=el});
}

function handleKeyDown_kb(e){
  if(e.key==='Escape'&&document.getElementById('fullscreen-overlay').classList.contains('show')){
    e.preventDefault();e.stopPropagation();exitFullscreenColorTest();return;
  }
  e.preventDefault();
  var code=e.code;
  if(pressedKeyCodes.has(code))return;
  pressedKeyCodes.add(code);

  var mods=[];
  if(e.ctrlKey)mods.push('Ctrl');if(e.altKey)mods.push('Alt');
  if(e.shiftKey)mods.push('Shift');if(e.metaKey)mods.push('Meta');

  document.getElementById('kb-last-key').textContent=e.key||'(空)';
  document.getElementById('kb-last-code').textContent=code;
  document.getElementById('kb-last-keycode').textContent=e.keyCode;
  document.getElementById('kb-modifiers').textContent=mods.join('+')||'无';

  keyHistoryList.unshift({key:e.key||code,code:code,event:'down',time:Date.now()});
  if(keyHistoryList.length>MAX_KH)keyHistoryList.pop();

  highlightKeyboardKey(code,true); // 持续高亮
  updateActiveKeys();
  updateKeyHistory();
  document.getElementById('kb-status-dot').className='status-dot active-dot';
  document.getElementById('kb-status-text').textContent='按键中';
}

function handleKeyUp_kb(e){
  if(document.getElementById('fullscreen-overlay').classList.contains('show'))return;
  e.preventDefault();
  var code=e.code;
  pressedKeyCodes.delete(code);

  keyHistoryList.unshift({key:e.key||code,code:code,event:'up',time:Date.now()});
  if(keyHistoryList.length>MAX_KH)keyHistoryList.pop();

  // 不移除高亮 — 持续高亮直到刷新
  updateActiveKeys();
  updateKeyHistory();
  if(pressedKeyCodes.size===0){
    document.getElementById('kb-status-dot').className='status-dot idle';
    document.getElementById('kb-status-text').textContent='待机';
  }
}

function highlightKeyboardKey(code,pressed){
  var el=keyElMap[code];
  if(!el)return;
  if(pressed)el.classList.add('pressed');
  // 不移除 — 持续高亮
}

function updateActiveKeys(){
  var c=document.getElementById('kb-active-keys');
  if(pressedKeyCodes.size===0){c.innerHTML='<span style="color:var(--text-muted);font-size:.8rem">等待按键...</span>';return}
  c.innerHTML=Array.from(pressedKeyCodes).map(function(k){return'<span class="indicator active"><span class="indicator-dot"></span>'+k+'</span>'}).join('');
}

function updateKeyHistory(){
  var c=document.getElementById('kb-history');
  if(keyHistoryList.length===0){c.innerHTML='<div class="key-history-empty">按下任意键开始记录...</div>';return}
  c.innerHTML=keyHistoryList.slice(0,30).map(function(item){
    return'<div class="key-history-item">'+
      '<span class="kh-key">'+item.key+'</span>'+
      '<span class="kh-code">'+item.code+'</span>'+
      '<span class="kh-event '+(item.event==='down'?'down-kh':'up-kh')+'">'+(item.event==='down'?'↓':'↑')+'</span>'+
    '</div>';
  }).join('');
}

let kbStarted=false;
function startKeyboardDetector(){
  if(!kbStarted){buildKeyboardUI();kbStarted=true}
  document.addEventListener('keydown',handleKeyDown_kb,true);
  document.addEventListener('keyup',handleKeyUp_kb,true);
  document.getElementById('kb-status-dot').className='status-dot idle';
  document.getElementById('kb-status-text').textContent='待机';
}
function stopKeyboardDetector(){
  pressedKeyCodes.clear();
  document.removeEventListener('keydown',handleKeyDown_kb,true);
  document.removeEventListener('keyup',handleKeyUp_kb,true);
}
