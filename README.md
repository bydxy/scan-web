# Scan Web — 在线扫码工具

一个基于浏览器的二维码 / 条形码在线扫描识别网站。**纯前端本地处理**，图片与摄像头数据不上传服务器，保护用户隐私。

## ✨ 功能特性

- 📷 **摄像头实时扫码**：调用设备摄像头，对准二维码即可自动识别
- 🖼️ **图片上传识别**：支持上传本地图片或拖拽、粘贴截图进行解析
- 🔍 **多码型支持**：二维码（QR Code）、条形码（EAN-13、Code 128 等）均可识别
- 🔒 **隐私安全**：所有识别均在浏览器本地完成，无任何数据上传
- 📱 **响应式设计**：适配手机、平板、桌面等各类屏幕
- ⚡ **免安装即用**：打开网页即可使用，无需下载 App

## 🛠️ 技术栈

| 模块 | 技术 |
|---|---|
| 扫码引擎 | [html5-qrcode](https://github.com/mebjas/html5-qrcode) / jsQR |
| 前端框架 | HTML5 + CSS3 + JavaScript |
| 相机调用 | MediaDevices API (getUserMedia) |
| 部署 | GitHub Pages / 静态托管 |

## 🚀 快速开始

```bash
# 克隆项目
git clone https://github.com/bydxy/scan-web.git

# 进入目录
cd scan-web

# 本地预览（任选其一）
python -m http.server 8080
# 或使用 VS Code 的 Live Server 插件
```

浏览器访问 `http://localhost:8080` 即可使用。

> 💡 摄像头功能需要 `HTTPS` 或 `localhost` 环境，这是浏览器的安全策略要求。

## 📖 使用说明

1. 打开网站，选择「相机扫码」或「图片识别」模式
2. 授权浏览器使用摄像头（首次使用会弹出授权提示）
3. 将二维码/条形码对准取景框，自动完成识别
4. 识别结果支持一键复制、链接直接跳转

## 🗺️ 开发计划

- [ ] 生成二维码功能
- [ ] 批量图片识别
- [ ] 扫码历史记录（本地存储）
- [ ] PWA 离线使用
- [ ] 多语言支持

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

[MIT License](LICENSE)
