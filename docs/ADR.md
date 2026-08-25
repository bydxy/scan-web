# 架构决策记录（ADR）

记录 scan-web 关键技术决策及理由，随代码同步演进。

## ADR-001 双引擎而非单一引擎

**决策**：原生 `BarcodeDetector` + ZXing-C++ WASM 双引擎。

**理由**：
- 原生 API 在 Safari 17~27 全线 disabled-by-default，Firefox Android 不支持——移动端不能只依赖它
- WASM 引擎全平台一致但需下载 ~1MiB（gzip ~461KB）——不该让 Android Chrome 用户白付这笔成本

**判定链**（缺一不可）：
1. `'BarcodeDetector' in window`
2. `await getSupportedFormats()` 覆盖全部目标码型
3. 构造 detector 无异常
4. **运行期**：detect 连续抛错 ≥3 次自动永久切换 WASM（微信 XWeb、魔改 ROM 兜底）

禁止按 UA 嗅探（如「微信=Chromium 所以用原生」）——能力检测永远优先于环境猜测。

## ADR-002 直连 zxing-wasm/reader 而非 ponyfill 抽象层

**决策**：WASM 路径直接使用 `readBarcodes(imageData, ReaderOptions)`。

**理由**：需要 ReaderOptions 完整控制权（try*/binarizer/maxNumberOfSymbols）来实现三级扫描策略；ponyfill 的 BarcodeDetector 风格抽象会抹掉这些旋钮。代价是两套调用代码，收益是极速档可把 try* 全部关闭（zxing-wasm v3 默认全开，不关则每帧多付数倍耗时）。

## ADR-003 三级扫描策略 + 分辨率阶梯

```
连续未命中 0-3 帧   → fast  @640 ROI   （近距正常码 <100ms）
           4-7 帧   → fast  @960 ROI   （远距小码升分辨率）
           8-15 帧  → rescue@960       （残缺/反色/歪斜：try* 全开）
           ≥16 帧   → rescue@原图 ROI  （最后手段）
命中即复位阶梯。
```

**理由**：640² = 41 万像素 vs 1080p = 207 万像素，解码开销近似随像素量线性涨；先小图快扫、失败再升级，兼顾速度与成功率。残缺码主要靠 QR 自带 Reed-Solomon 纠错（H 级容 30% 码字损坏）+ rescue 启发式，而非逐帧重预处理（实测重预处理管线反而拖慢实时体验）。图像变体（GlobalHistogram 二值化）仅作静态兜底。

## ADR-004 忙则丢帧，绝不排队

**决策**：rVFC 回调中若上一帧仍在解码，直接丢弃当前帧。

**理由**：排队会导致识别停留在几百毫秒前的旧画面——用户已经移开手机，结果才弹出来，这是扫码器的致命体验。丢帧保证「看到的即正在识别的」。

## ADR-005 ROI 按 cover 坐标映射裁剪

**决策**：取景框在屏幕上是居中 72% 正方形，但 `object-fit: cover` 会裁切视频边缘，必须做屏幕→视频像素坐标换算后再 drawImage。

**理由**：不做映射会出现「框对准了却扫不出」的诡异 bug（实际送解码的是画面另一区域），且该问题只在部分宽高比设备复现，极难排查。

## ADR-006 WASM 同源自托管 + 懒加载

**决策**：`.wasm` 通过 Vite `?url` 导出为构建产物同源部署；`prepareZXingModule({ overrides: { locateFile } })` 指向本地路径；仅在首次需要时 dynamic import。

**理由**：生产不依赖 jsDelivr CDN（可用性/CSP/离线三重考虑）；懒加载保证首屏 gzip <10KB；配合 SW 运行时缓存二次进入零下载。

## ADR-007 零框架 + 纯 CSS Liquid Glass

**决策**：vanilla TypeScript，不用 React/Vue；玻璃材质三层实现（iOS 26 `-apple-visual-effect` → backdrop-filter → 纯色降级）。

**理由**：单页三态的应用复杂度不需要框架运行时；相机预览是持续变化的背景，大面积 backdrop-filter 本身就吃 GPU，必须控制并发玻璃层数与总渲染成本。

## ADR-008 连续多码检测 + 实时跟随标签

**决策**：命中后不再停止扫描，改为持续跟踪；每个码渲染一个绝对定位的玻璃小标签，锚定其左上角，随移动逐帧更新位置；点按标签弹出完整结果。

**实现要点**：
- WASM 极速档 `maxNumberOfSymbols: 8`（救援档 16），原生 API 天然返回数组——多码同框两引擎均覆盖
- 坐标链：码角点（ROI 像素系）→ 逆推 grab 裁剪缩放 → 视频像素系 → cover 变换 → 屏幕 CSS 像素。任何一环漏掉都会导致标签与码错位
- 标签用 `translate3d` 定位（GPU 合成，不触发重排），`will-change: transform`
- 失踪判定：800ms 未再识别到即移除标签，防止抖动闪烁
- 阶梯软复位：命中时 `misses -= 2` 而非清零——跟踪移动中的码时避免在极速/救援档间震荡
- 新码发现才震动、才写历史（localStorage 去重后仅变更时落盘）

**取舍**：放弃「扫到一个就锁屏展示」的传统流程，改为 AR 式标注流。用户主动点按感兴趣的码查看详情，多码场景效率更高。
