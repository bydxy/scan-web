/**
 * 二维码再生成：扫描内容 → 新二维码（自定义颜色/尺寸/边距）
 * 预览 / 下载 PNG / 复制图片 / 系统分享，全部本地完成。
 * qrcode 库按需动态加载，不占首屏体积。
 */

export interface QrStyle {
  fg: string;
  bg: string;
  size: number; // px
  margin: number; // 模块数
}

export const DEFAULT_QR_STYLE: QrStyle = { fg: '#000000', bg: '#ffffff', size: 512, margin: 2 };

type QRCodeToCanvas = typeof import('qrcode').toCanvas;

let libPromise: Promise<QRCodeToCanvas> | null = null;

async function getToCanvas(): Promise<QRCodeToCanvas> {
  if (!libPromise) {
    libPromise = import('qrcode').then((m) => m.toCanvas.bind(m) as QRCodeToCanvas);
  }
  return libPromise;
}

export async function renderQr(
  canvasEl: HTMLCanvasElement,
  text: string,
  style: QrStyle
): Promise<void> {
  const toCanvas = await getToCanvas();
  await toCanvas(canvasEl, text, {
    width: style.size,
    margin: style.margin,
    color: { dark: style.fg, light: style.bg },
    errorCorrectionLevel: 'M',
  });
}

export function downloadQr(canvasEl: HTMLCanvasElement, name = `qrcode-${Date.now()}.png`): void {
  const a = document.createElement('a');
  a.href = canvasEl.toDataURL('image/png');
  a.download = name;
  a.click();
}

export async function copyQrImage(canvasEl: HTMLCanvasElement): Promise<boolean> {
  try {
    const blob = await new Promise<Blob | null>((res) =>
      canvasEl.toBlob((b) => res(b), 'image/png')
    );
    if (!blob) return false;
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    return true;
  } catch {
    return false;
  }
}

export async function shareQr(canvasEl: HTMLCanvasElement, text: string): Promise<boolean> {
  try {
    const blob = await new Promise<Blob | null>((res) =>
      canvasEl.toBlob((b) => res(b), 'image/png')
    );
    if (!blob || !navigator.share) return false;
    const file = new File([blob], 'qrcode.png', { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file], text });
      return true;
    }
    await navigator.share({ text });
    return true;
  } catch {
    return false;
  }
}
