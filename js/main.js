// ================================================================
//  main.js — 初始化入口
//  依赖：所有检测器模块 + navigation.js
//  说明：主页加载时启动鼠标检测与屏幕信息采集；
//        其余检测器由 navigateTo() 按需启停。
// ================================================================

function init(){
  startMouseDetector();
  updateScreenInfo();
  detectRefreshRate();
}
init();
