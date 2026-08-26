import './style.css';
import { CameraManager } from './camera.js';
import { FramePipeline } from './pipeline.js';
import type { FrameHits } from './pipeline.js';
import { ScannerAdapter, scanImageFile } from './scanner/index.js';
import type { ScanResult } from './scanner/index.js';
import type { FormatGroup } from './formats.js';
import { classify } from './apps.js';
import { getSettings, updateSettings, applySettings } from './settings.js';
import * as history from './history.js';
import { LabelOverlay } from './ui/labels.js';
import { presentResults, bindBatchActions } from './ui/results.js';
import { openHistorySheet } from './ui/history-ui.js';
import { openSettingsSheet, bindSettings, runStartupClean } from './ui/settings-ui.js';
import { openQrSheet, rememberOriginal } from './ui/qrsheet.js';
import { toast, vibrate, beep } from './ui/feedback.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const homeView = $<HTMLElement>('home-view');
const scanView = $<HTMLElement>('scan-view');
const video = $<HTMLVideoElement>('camera');
const canvas = $<HTMLCanvasElement>('frame-buffer');
const engineBadge = $<HTMLElement>('engine-badge');
const btnTorch = $<HTMLButtonElement>('btn-torch');
const btnArea = $<HTMLButtonElement>('btn-area');
const btnGroup = $<HTMLButtonElement>('btn-group');
const btnMode = $<HTMLButtonElement>('btn-mode');
const zoomSlider = $<HTMLInputElement>('zoom-slider');

/* ---------- 全局状态 ---------- */
let scanner: ScannerAdapter | null = null;
let pipeline: FramePipeline | null = null;
let overlay: LabelOverlay | null = null;
let torchOn = false;
const seenSession = new Set<string>();
const dupWarned = new Set<string>();

/* ---------- 识别命中处理 ---------- */
function onHits(hits: FrameHits): void {
  overlay!.update(hits);

  for (const r of hits.results) {
    const kind = classify(r.text).kind;
    const isNewToStore = !history.has(r.text);
    if (getSettings().saveHistory && isNewToStore) {
      history.add(r.text, r.format, kind);
      feedbackNew();
      maybeAutoOpen(r);
    }
    if (seenSession.has(r.text) && !dupWarned.has(r.text)) {
      dupWarned.add(r.text);
      toast('该内容本次会话已扫过');
    }
    seenSession.add(r.text);
    captureOriginal(r, hits);
  }
}

function feedbackNew(): void {
  if (getSettings().vibrate) vibrate(30);
  if (getSettings().sound) beep();
}

function maybeAutoOpen(r: ScanResult): void {
  if (!getSettings().autoOpen) return;
  const resolved = classify(r.text);
  if (resolved.kind === 'url' && !resolved.risk?.includes('HTTP')) {
    resolved.actions?.find((a) => a.label === '打开链接')?.run();
  }
}

/** 原图裁剪：按码包围盒从视频帧裁高清 PNG（保留原始颜色/Logo/样式） */
function captureOriginal(r: ScanResult, hits: FrameHits): void {
  if (!r.corners?.length || !video.videoWidth) return;
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  const vx = r.corners.map((c) => hits.src.x + (c.x / hits.out.w) * hits.src.w);
  const vy = r.corners.map((c) => hits.src.y + (c.y / hits.out.h) * hits.src.h);
  const pad = Math.max((Math.max(...vx) - Math.min(...vx)) * 0.12, 8);
  const x = Math.max(0, Math.min(...vx) - pad);
  const y = Math.max(0, Math.min(...vy) - pad);
  const w = Math.min(vw - x, Math.max(...vx) + pad - x);
  const h = Math.min(vh - y, Math.max(...vy) + pad - y);
  if (w <= 8 || h <= 8) return;

  const c2 = document.createElement('canvas');
  c2.width = Math.round(w);
  c2.height = Math.round(h);
  c2.getContext('2d')!.drawImage(video, x, y, w, h, 0, 0, c2.width, c2.height);
  rememberOriginal(r.text, c2.toDataURL('image/png'));
}

/* ---------- 结果呈现（单次模式弹出即停流） ---------- */
const resultHooks = {
  onGenerateQr: (text: string) => openQrSheet(text),
  onExportJson: () => history.exportJSON(),
};

function presentForMode(results: ScanResult[]): void {
  presentResults(results, resultHooks);
  if (getSettings().mode === 'single') {
    pipeline?.stop();
    camera.setTorch(false);
  }
}

/* ---------- 扫描流程 ---------- */
async function startScanning(): Promise<void> {
  const s = getSettings();
  applySettings(s);
  scanner ??= await ScannerAdapter.create(s.group);
  await scanner.setGroup(s.group);
  updateEngineBadge();

  try {
    const caps = await camera.start(video);
    btnTorch.hidden = !caps.torch;
    zoomSlider.hidden = !caps.zoom;
    if (caps.zoom) {
      zoomSlider.min = String(caps.zoom.min);
      zoomSlider.max = String(caps.zoom.max);
      zoomSlider.step = String(caps.zoom.step);
      zoomSlider.value = String(caps.zoom.value);
    }
    torchOn = false;
  } catch (e) {
    showPermissionGuide(e as Error);
    return;
  }

  pipeline ??= new FramePipeline(
    video,
    canvas,
    scanner,
    onHits,
    ({ lowLight }) => ($<HTMLElement>('low-hint').hidden = !lowLight)
  );
  pipeline.start();
  overlay ??= new LabelOverlay(video, (r) => presentForMode([r]));
  overlay.mount(scanView);
  show(scanView);
  syncControlLabels();
}

function resumeScanning(): void {
  pipeline?.resetTier();
  pipeline?.start();
}

function stopScanning(): void {
  pipeline?.stop();
  camera.stop();
  overlay?.clear();
}

function stopScanningToHome(): void {
  stopScanning();
  closeSheets();
  show(homeView);
}

function updateEngineBadge(): void {
  const kind = scanner?.engineKind;
  engineBadge.textContent =
    kind === 'native' ? '原生引擎' : kind === 'wasm' ? 'WASM 引擎' : '…';
}

function syncControlLabels(): void {
  const s = getSettings();
  btnArea.textContent = s.area === 'viewfinder' ? '取景框' : '全屏';
  btnGroup.textContent =
    s.group === 'all' ? '全部码型' : s.group === 'qr' ? '仅二维码' : '仅条形码';
  btnMode.textContent = s.mode === 'continuous' ? '连续' : '单次';
}

function showPermissionGuide(e: Error): void {
  const messages: Record<string, [string, string]> = {
    PERMISSION_DENIED: ['相机权限被拒绝', '请在浏览器设置中允许本站点访问相机后重试'],
    NO_DEVICE: ['未检测到摄像头', '请确认设备有可用摄像头后重试'],
    DEVICE_BUSY: ['摄像头被占用', '请关闭其他使用摄像头的应用/标签页后重试'],
    INSECURE_CONTEXT: ['需要 HTTPS 环境', '相机功能要求安全连接，请通过 HTTPS 访问'],
    NO_MEDIA_DEVICES: ['浏览器不支持', '当前浏览器内核过旧或被限制，请更换浏览器'],
    REQUEST_FAILED: ['启动失败', '相机请求失败，请重试'],
  };
  const [title, desc] = messages[e.name] ?? messages.REQUEST_FAILED;
  $('perm-title').textContent = title;
  $('perm-desc').textContent = desc;
  $<HTMLElement>('perm-sheet').hidden = false;
}

/* ---------- 视图与弹层 ---------- */
function show(view: HTMLElement): void {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('view--active'));
  view.classList.add('view--active');
}

function closeSheets(): void {
  ['result-sheet', 'history-sheet', 'settings-sheet', 'perm-sheet', 'qr-sheet'].forEach(
    (id) => ($<HTMLElement>(id).hidden = true)
  );
}

/* ---------- 相机 ---------- */
const camera = new CameraManager();
camera.onStreamLost = () => {
  toast('相机连接中断，请重新开始扫描');
  stopScanningToHome();
};

/* ---------- 事件绑定 ---------- */
$('btn-start').onclick = () => void startScanning();
$('btn-back').onclick = stopScanningToHome;

$('btn-flip').onclick = async () => {
  const caps = await camera.flip(video).catch(() => null);
  btnTorch.hidden = !caps?.torch;
  zoomSlider.hidden = !caps?.zoom;
  pipeline?.resetTier();
};

$('btn-pause').onclick = (e) => {
  const btn = e.currentTarget as HTMLButtonElement;
  if (btn.textContent === '暂停') {
    pipeline?.stop();
    btn.textContent = '继续';
  } else {
    resumeScanning();
    btn.textContent = '暂停';
  }
};

btnTorch.onclick = () => {
  torchOn = !torchOn;
  camera.setTorch(torchOn);
};

zoomSlider.oninput = () => camera.setZoom(Number(zoomSlider.value));

btnArea.onclick = () => {
  const next = getSettings().area === 'viewfinder' ? 'full' : 'viewfinder';
  updateSettings({ area: next });
  pipeline?.resetTier();
  syncControlLabels();
};

btnGroup.onclick = async () => {
  const order: FormatGroup[] = ['all', 'qr', 'barcode'];
  const cur = getSettings().group;
  const next = order[(order.indexOf(cur) + 1) % order.length];
  updateSettings({ group: next });
  await scanner?.setGroup(next);
  pipeline?.resetTier();
  syncControlLabels();
};

btnMode.onclick = () => {
  const next = getSettings().mode === 'continuous' ? 'single' : 'continuous';
  updateSettings({ mode: next });
  syncControlLabels();
};

$('btn-history').onclick = () =>
  openHistorySheet({
    onGenerateQr: (t) => openQrSheet(t),
    onPick: (text, format) =>
      presentForMode([{ text, format, corners: [] }]),
  });

$('btn-settings').onclick = () => openSettingsSheet();

bindBatchActions(resultHooks);
$('btn-rescan').onclick = () => {
  $<HTMLElement>('result-sheet').hidden = true;
  if (scanView.classList.contains('view--active') && getSettings().mode === 'single') {
    resumeScanning();
  }
};

document.querySelectorAll('.sheet__backdrop').forEach((b) => {
  (b as HTMLElement).onclick = () =>
    ['history-sheet', 'settings-sheet', 'qr-sheet', 'perm-sheet'].forEach(
      (id) => ($<HTMLElement>(id).hidden = true)
    );
});

$('file-input').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const results = await scanImageFile(file, getSettings().group);
    if (results.length > 0) {
      if (getSettings().vibrate) vibrate(30);
      presentForMode(results);
    } else {
      toast('未能识别出条码，请尝试更清晰的照片');
    }
  } finally {
    input.value = '';
  }
};

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    camera.setTorch(false);
    pipeline?.stop();
  } else if (
    scanView.classList.contains('view--active') &&
    $<HTMLElement>('result-sheet').hidden
  ) {
    resumeScanning();
  }
});

window.addEventListener('resize', () => overlay?.clear());

/* ---------- 启动 ---------- */
applySettings();
runStartupClean();
bindSettings(() => {
  syncControlLabels();
  pipeline?.resetTier();
});
ScannerAdapter.create(getSettings().group).then(async (s) => {
  scanner = s;
  await scanner.setGroup(getSettings().group);
  updateEngineBadge();
});

/* PWA：生产环境注册 SW；新版本就绪时提示刷新 */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
    navigator.serviceWorker.addEventListener('message', (e) => {
      if ((e.data as { type?: string })?.type === 'UPDATED') {
        $<HTMLElement>('sw-toast').hidden = false;
      }
    });
  });
  $<HTMLElement>('sw-toast').onclick = () => location.reload();
}

if (!navigator.onLine) $<HTMLElement>('offline-badge').hidden = false;
window.addEventListener('online', () => ($<HTMLElement>('offline-badge').hidden = true));
window.addEventListener('offline', () => ($<HTMLElement>('offline-badge').hidden = false));
