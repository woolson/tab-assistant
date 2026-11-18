# 搜索框玻璃渲染

`createSearchGlass` 提供经典、毛玻璃和液态玻璃三种材质。毛玻璃使用透明底色与 `backdrop-filter: blur()`；液态玻璃使用独立的背景位移、阅读区域和边缘高光三层。

- `shader.ts` 移植用户指定的 [shuding/liquid-glass](https://github.com/shuding/liquid-glass) 的 SDF、两次 smoothStep 及 UV 缩放公式；`liquidSurface.ts` 保留原实现的两遍位移归一化与裁切，并使用 SVG 实时折射网页背景。
- `contour.ts` 为高光和阅读区域生成与 CSS 一致的蒙版：`squircle` 对应四次超椭圆，旧浏览器使用圆弧。折射层沿用参考的 blur(.25px)、contrast(1.2)、brightness(1.05)、saturate(1.1)；搜索内容区域额外轻度柔化。生成的灰度及透明度贴图不包含网页像素，不截图或复制页面 DOM。
- 网页内搜索在顶层 dialog 中创建光学层，扩展 iframe 负责文字内容。整页蒙层通过 dialog 的大范围外阴影实现，在玻璃下面留出与 `squircle` 一致的孔洞，避免把玻璃染灰。
- 不要对光学层祖先设置 `opacity < 1`、`filter`、`backdrop-filter`、`mask` 或 `isolation`。退出时分别淡出各层，缩放只作用于 iframe。
- SVG 定义放到当前文档，确保闭合 ShadowRoot 中的滤镜引用可解析；关闭时删除定义、取消计时器并断开 ResizeObserver。异步贴图解码完成后也会核对实例是否已销毁。
- 贴图长边不超过 480px，最多缓存四种尺寸；拖动中立即更新滤镜边界，停止后重新生成贴图。首次注入与重建升级通过 Webpack 构建哈希区分，重复快捷键保留同一渲染器的滤镜序号。
- 独立窗口和设置预览复用同一个渲染器。独立窗口处理窗口内背景，不采样系统桌面。非 Chromium 浏览器降级为毛玻璃。

`vendor/` 保留 MIT 项目 [Nordify css-liquid-glass](https://github.com/nordify/css-liquid-glass) 的源文件快照和来源摘要。当前只复用 `maps.ts` 的 PNG 编码及灰度/透明度通道打包，不使用原先的圆弧渲染器；本地将 `maskPng` 额外导出。Shu Ding 的原始许可见 `vendor/shuding-LICENSE`；两份许可证均复制到构建产物的 `third-party-licenses/`。

实现参考 [CSS 与 SVG 液态玻璃实验](https://kube.io/blog/liquid-glass-css-svg/)、[Apple Liquid Glass 设计介绍](https://developer.apple.com/videos/play/wwdc2025/219/) 及 [CSS corner-shape](https://drafts.csswg.org/css-borders-4/#propdef-corner-shape)。
