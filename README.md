# Hardware Check - 硬件外设检测工具

一站式硬件外设检测工具，基于纯 HTML/CSS/JavaScript 实现，无需任何依赖，浏览器打开即用。

实时反馈鼠标、键盘、手柄及屏幕状态，支持白色简约 / 暗色夜间双主题自动切换。

## 功能模块

### 鼠标检测

- 实时坐标追踪（页面坐标 / 视口坐标）
- 十字准星可视化 + 坐标气泡提示
- 左 / 中 / 右键状态指示灯
- 滚轮方向与增量
- 点击涟漪动画
- 移动事件与点击计数

### 键盘检测

- 完整 108 键全键盘布局（功能键区 + 主键区 + 导航区 + 小键盘区）
- 按下即持续高亮，刷新后清除
- 实时显示按键 key / code / keyCode / 修饰键
- 按键历史记录（keydown / keyup 事件流）

### 手柄检测

- Gamepad API 自动轮询检测手柄连接
- SVG 手柄示意图：左右摇杆位置可视化 + 倾斜方向线
- 肩键状态显示（L1 / L2 / R1 / R2）
- 摇杆轴值条形图
- 全部按钮状态网格 + 模拟值

### 屏幕检测

- 屏幕信息：物理分辨率、可用区域、DPR、色彩深度、刷新率、窗口尺寸、方向、触摸支持
- 刷新率检测：120 帧采样 + 异常值剔除 + 常见刷新率圆整
- 刷新率对比动画（参考 [testufo.com](https://testufo.com/)）：30fps / 60fps / 本机刷新率 UFO 移动对比
- 纯色坏点检测：9 种颜色全屏切换
- 渐变色彩测试
- 全屏模式（ESC 优先退出颜色检测，而非浏览器全屏）

## 使用方法

1. 下载 `monitoring-station.html` 文件
2. 用现代浏览器（Chrome / Edge / Firefox / Safari）直接打开
3. 无需安装任何依赖，无需构建步骤

> 手柄检测需要先连接手柄并按任意按键激活 Gamepad API。

## 技术特点

- **零依赖** — 单文件 HTML，无外部库、无构建工具
- **双主题** — 白色简约（默认） / 暗色夜间模式，通过 `prefers-color-scheme` 自动切换
- **响应式** — 适配桌面 / 平板 / 手机（900px / 600px 断点）
- **SPA 路由** — 单页应用，页面切换带过渡动画，检测器自动启停
- **可扩展** — 卡片网格自动适配，新增检测项目只需添加卡片 + 对应 page div

## 技术栈

- HTML5
- CSS3（CSS 变量 / Grid / Flexbox / 媒体查询）
- Vanilla JavaScript（Gamepad API / Fullscreen API / Canvas 2D / requestAnimationFrame）

## 项目地址

[https://github.com/Vevolat/Hardware-Check](https://github.com/Vevolat/Hardware-Check)

## License

MIT
