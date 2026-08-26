# Scan · 极速扫码

基于浏览器的实时扫码 Web 应用：多码同扫、AR 式空间标注、App 识别跳转、二维码再生成。**纯前端本地处理，数据不出设备**。UI 采用 iOS 26 Liquid Glass 风格。

> 📱 手机浏览器打开即用（PWA 可添加到主屏幕）
> 🔗 在线地址：https://bydxy.github.io/scan-web/

## 功能总览

### 扫描引擎

- 双引擎：原生 `BarcodeDetector`（Android Chromium 极速路径）+ ZXing-C++ WASM 全平台兜底
- 能力检测链验证 `getSupportedFormats()`；原生未命中节流升级 WASM；运行期连续异常自动热降级
- 三级策略：FAST → RESCUE（残缺/反色/歪斜启发式）→ 二值化变体
- 区域阶梯：取景框 ROI 快扫 → 失败自动扩全屏；热点优先（上次命中位置 1.2s 内小窗直扫）
- 多帧确认防误报；Sobel/Laplacian 清晰度筛帧跳过模糊画面；低光环境提示
- 忙则丢帧绝不排队；Canvas 上下文与尺寸缓存减少每帧开销
- 码型范围切换：全部 / 仅二维码 / 仅条形码；单次 / 连续模式

### 标注与结果

- SVG 描边贴合码的四角：随大小伸缩、随移动移动、旋转透视都能包住
- 内容 chip 骑在码框上方，点按查看详情
- 多结果列表 + 批量复制 / 批量分享 / 导出 JSON
- 长文本展开折叠；URL 风险提示（HTTP / IP 直连 / 伪装域名）

### 内容快捷动作

- 已知 App 命名并唤起：支付宝收款码官方 scheme、抖音/快手/百度 webview scheme、微信/淘宝/京东等 Universal Link 路由
- 电话拨打、邮件发送、地图搜索地址
- Wi-Fi 密码解析复制；vCard 存通讯录 (.vcf)；日历日程 (.ics)
- 商品条码一键淘宝/京东搜同款
- 纯文本一键复制

### 二维码再生成

- 扫描内容重新生成二维码：自定义前景/背景色、尺寸、边距
- 预览 / 下载 PNG / 复制图片到剪贴板 / 系统分享
- 同时保存原始截图（按包围盒从视频帧裁剪高清原图，保留原样式与 Logo）
- 历史记录中可再次生成

### 历史管理

- 搜索（内容+备注）、类型/格式/时间筛选、收藏过滤
- 单条删除、清空（收藏保护）、备注、收藏
- 导出 JSON / CSV；自动清理过期记录

### 设置与隐私

- 保存历史开关、自动清理周期、提示音、震动、自动打开链接
- 默认模式/区域/码型、主题（跟随系统/深/浅）、低性能设备自动关闭玻璃模糊
- 所有数据仅存本机；离线状态完整可用并有标识

## 技术栈

| 层 | 选型 |
|---|---|
| 构建 | Vite 7 + TypeScript（零框架） |
| 扫码 | BarcodeDetector + zxing-wasm/reader（动态 import，同源自托管 WASM） |
| QR 生成 | qrcode 库懒加载 |
| UI | 纯 CSS Liquid Glass（`-apple-visual-effect` 渐进增强） |
| 测试 | Vitest（格式映射/内容分类/历史存储 13 例） |

## 性能指标

- 首屏 gzip ≈ **12KB**（HTML+CSS+JS），WASM 解码器 461KB gzip 独立懒加载，二次进入缓存零下载
- 近距正常码目标命中 <100ms；模糊帧不送解码

## 本地开发

```bash
npm install
npm run dev      # 开发服务器
npm run build    # 生产构建 → dist/
npm test         # 运行单元测试
```

> 摄像头要求 HTTPS 或 localhost。

## 文档

- [技术调研报告](docs/技术调研报告.md) · [移动端方案 V2](docs/移动端方案调研V2.md) · [架构决策记录 ADR](docs/ADR.md)

## 许可证

[MIT](LICENSE)
