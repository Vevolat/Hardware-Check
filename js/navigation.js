// ================================================================
//  navigation.js — 页面导航 / SPA 路由
//  依赖：各检测器模块需提供 startXxxDetector() / stopXxxDetector()
//        mouse-detector.js / keyboard-detector.js / gamepad-detector.js
//        headphone-detector.js / screen-detector.js
// ================================================================

function navigateTo(page){
  document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));
  const t=document.getElementById(page+'-page');
  if(t)t.classList.add('active');
  stopAllDetectors();
  if(page==='mouse')startMouseDetector();
  else if(page==='keyboard')startKeyboardDetector();
  else if(page==='gamepad')startGamepadDetector();
  else if(page==='headphone')startHeadphoneDetector();
  else if(page==='screen'){updateScreenInfo();detectRefreshRate();startRefreshAnims()}
  exitFullscreenColorTest();
}

function stopAllDetectors(){
  stopMouseDetector();
  stopKeyboardDetector();
  stopGamepadDetector();
  stopHeadphoneDetector();
  stopRefreshAnims();
}
