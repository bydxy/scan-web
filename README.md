# Scan · 极速扫码

基于浏览器的实时扫码 Web 应用：二维码 / 条形码多码型识别，**纯前端本地处理，数据不出设备**。UI 采用 iOS 26 Liquid Glass 风格。

> 📱 手机浏览器打开即用，支持添加到主屏幕（PWA）
> 🔗 在线地址：https://bydxy.github.io/scan-web/

## 核心架构

```
Camera (getUserMedia)
  │  requestVideoFrameCallback · 忙则丢帧绝不排队
  ▼
ROI 裁剪（cover 坐标映射）→ 清晰度评分筛掉模糊帧
  │
  ▼
ScannerAdapter 双引擎 + 三级策略
  ├─ Native BarcodeDetector   Android Chromium 零成本极速路径
  │    └─ 能力检测链验证 getSupportedFormats()，运行期连续异常自动热降级
  └─ ZXing-C++ WASM           Safari / Firefox / WebView 全覆盖
       ├─ FAST   @640 ROI · 最小选项集
       ├─ RESCUE @960 · tryHarder/Invert/Rotate/Downscale 全开（残缺/反色/歪斜）
       └─ VARIANT· GlobalHistogram 二值化变体兜底
```

## 技术栈

| 层 | 选型 |
|---|---|
| 构建 | Vite 7 + TypeScript（零框架） |
| 扫码 | 原生 BarcodeDetector + [zxing-wasm](https://github.com/Sec-ant/zxing-wasm)（动态 import 懒加载，同源自托管） |
| UI | 纯 CSS Liquid Glass（`-apple-visual-effect` 渐进增强） |
| PWA | manifest + Service Worker 运行时缓存 |

## 性能指标

- **首屏 gzip ≈ 9 KB**（HTML 1.4 + CSS 2.1 + JS 5.2），WASM 解码器 461KB gzip 独立懒加载，二次进入 HTTP 缓存零下载
- 近距正常码目标命中 < 100ms；模糊帧直接跳过不浪费解码算力
- 支持码型：QR / EAN-13 / EAN-8 / UPC-A / UPC-E / Code128 / Code39 / Code93 / ITF / Codabar / DataMatrix / PDF417 / Aztec

## 功能

- 🎯 **连续多码检测**：同框多个二维码/条形码同时识别，AR 式小标签跟随码移动，点按查看详情
- 📷 实时取景扫码（前后镜头切换、闪光灯能力检测、1920p 高清输入提升小码识别率）
- 🖼️ 相册图片识别（直读文件，一步救援档）
- 🕐 本机历史记录（最近 20 条，localStorage，不上传）
- 📋 结果一键复制 / 链接直达跳转 / 新码发现震动反馈
- 🔐 权限状态机引导（被拒/占用/无设备/非HTTPS 分场景提示）

## 本地开发

```bash
npm install
npm run dev      # 开发服务器
npm run build    # 生产构建 → dist/
```

> 摄像头要求 HTTPS 或 localhost。

## 文档

- [技术调研报告](docs/技术调研报告.md) — 引擎选型对比
- [移动端方案调研 V2](docs/移动端方案调研V2.md) — iOS 兼容要点与 Liquid Glass 实现
- [架构决策记录](docs/ADR.md) — 关键技术决策及理由

## 许可证

[MIT](LICENSE)
