import { renderQr, downloadQr, copyQrImage, shareQr } from '../qrgen.js';
import type { QrStyle } from '../qrgen.js';
import { toast } from './feedback.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** 会话内原始截图缓存（text → dataURL），刷新后失效 */
const originals = new Map<string, string>();

export function rememberOriginal(text: string, dataUrl: string): void {
  if (originals.size > 40) originals.delete(originals.keys().next().value!);
  originals.set(text, dataUrl);
}

let currentText = '';

export function openQrSheet(text: string): void {
  currentText = text;
  const style = readStyle();
  $<HTMLInputElement>('qr-fg').value = style.fg;
  $<HTMLInputElement>('qr-bg').value = style.bg;
  $<HTMLSelectElement>('qr-size').value = String(style.size);
  $<HTMLInputElement>('qr-margin').value = String(style.margin);

  $<HTMLElement>('qr-original-wrap').hidden = !originals.has(text);

  bindOnce();
  void redraw();
  $<HTMLElement>('qr-sheet').hidden = false;
}

function readStyle(): QrStyle {
  return {
    fg: $<HTMLInputElement>('qr-fg').value || '#000000',
    bg: $<HTMLInputElement>('qr-bg').value || '#ffffff',
    size: Number($<HTMLSelectElement>('qr-size').value) || 512,
    margin: Math.max(0, Math.min(8, Number($<HTMLInputElement>('qr-margin').value) || 0)),
  };
}

async function redraw(): Promise<void> {
  try {
    await renderQr($<HTMLCanvasElement>('qr-canvas'), currentText, readStyle());
  } catch {
    /* 内容过长无法生成时静默 */
  }
}

let bound = false;

function bindOnce(): void {
  if (bound) return;
  bound = true;
  for (const id of ['qr-fg', 'qr-bg', 'qr-size', 'qr-margin'] as const) {
    $(id).onchange = () => void redraw();
    $(id).oninput = () => void redraw();
  }
  $('qr-download').onclick = () => downloadQr($<HTMLCanvasElement>('qr-canvas'));
  $('qr-copy').onclick = async () =>
    toast((await copyQrImage($<HTMLCanvasElement>('qr-canvas'))) ? '图片已复制' : '复制失败（浏览器不支持）');
  $('qr-share').onclick = async () => {
    const ok = await shareQr($<HTMLCanvasElement>('qr-canvas'), currentText);
    if (!ok) toast('当前环境不支持分享');
  };
  $('qr-original').onclick = () => {
    const url = originals.get(currentText);
    if (!url) return;
    const a = document.createElement('a');
    a.href = url;
    a.download = `original-${Date.now()}.png`;
    a.click();
  };
  $('qr-close').onclick = () => ($<HTMLElement>('qr-sheet').hidden = true);
}
