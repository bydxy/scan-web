import './style.css';
import { CameraManager } from './camera.js';
import { FramePipeline } from './pipeline.js';
import { ScannerAdapter, scanImageFile } from './scanner/index.js';
import type { ScanResult } from './scanner/index.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const homeView = $<HTMLElement>('home-view');
const scanView = $<HTMLElement>('scan-view');
const video = $<HTMLVideoElement>('camera');
const canvas = $<HTMLCanvasElement>('frame-buffer');
const engineBadge = $<HTMLElement>('engine-badge');
const btnTorch = $<HTMLButtonElement>('btn-torch');
const scanHint = $<HTMLElement>('scan-hint');

const resultSheet = $<HTMLElement>('result-sheet');
const resultType = $<HTMLElement>('result-type');
const resultText = $<HTMLElement>('result-text');
const btnOpen = $<HTMLAnchorElement>('btn-open');
const historySheet = $<HTMLElement>('history-sheet');
const historyList = $<HTMLUListElement>('history-list');
const permSheet = $<HTMLElement>('perm-sheet');
const permTitle = $<HTMLElement>('perm-title');
const permDesc = $<HTMLElement>('perm-desc');

const camera = new CameraManager();
let scanner: ScannerAdapter | null = null;
let pipeline: FramePipeline | null = null;
let torchOn = false;

/* ---------- 视图切换 ---------- */
function show(view: HTMLElement): void {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('view--active'));
  view.classList.add('view--active');
}

function closeSheet(sheet: HTMLElement): void {
  sheet.hidden = true;
}

/* ---------- 历史 ---------- */
const HISTORY_KEY = 'scan-web.history.v1';

function loadHistory(): Array<{ text: string; format: string; at: number }> {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveHistory(results: ScanResult[]): void {
  const items = loadHistory();
  for (const r of results) {
    if (!items.some((i) => i.text === r.text)) {
      items.unshift({ ...r, at: Date.now() });
    }
  }
  localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 20)));
}

function renderHistory(): void {
  historyList.innerHTML = '';
  const items = loadHistory();
  if (items.length === 0) {
    historyList.innerHTML = '<li>暂无记录<span>扫一扫，记录会保存在本机</span></li>';
    return;
  }
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = item.text;
    const meta = document.createElement('span');
    meta.textContent = `${item.format} · ${new Date(item.at).toLocaleString()}`;
    li.appendChild(meta);
    li.onclick = () => {
      closeSheet(historySheet);
      presentResults([{ text: item.text, format: item.format }]);
    };
    historyList.appendChild(li);
  }
}

/* ---------- 结果呈现 ---------- */
function presentResults(results: ScanResult[]): void {
  const first = results[0];
  resultType.textContent =
    first.format === 'QRCode' ? '二维码' : `条形码 · ${first.format}`;
  resultText.textContent = first.text;

  const isUrl = /^https?:\/\//i.test(first.text);
  btnOpen.hidden = !isUrl;
  if (isUrl) btnOpen.href = first.text;

  saveHistory(results);
  resultSheet.hidden = false;
}

function vibrate(): void {
  navigator.vibrate?.(30);
}

async function copyResult(): Promise<void> {
  try {
    await navigator.clipboard.writeText(resultText.textContent ?? '');
    btnCopy.textContent = '已复制 ✓';
    setTimeout(() => (btnCopy.textContent = '复制'), 1200);
  } catch {
    /* 剪贴板不可用时静默 */
  }
}
const btnCopy = $<HTMLButtonElement>('btn-copy');

/* ---------- 扫描流程 ---------- */
async function startScanning(): Promise<void> {
  scanner ??= await ScannerAdapter.create();
  updateEngineBadge();

  try {
    const torch = await camera.start(video);
    btnTorch.hidden = !torch.supported;
    torchOn = false;
  } catch (e) {
    showPermissionGuide(e as Error);
    return;
  }

  pipeline ??= new FramePipeline(video, canvas, scanner, (results) => {
    vibrate();
    pipeline!.stop();
    camera.setTorch(false);
    presentResults(results);
  });
  pipeline.start();
  show(scanView);
  scanHint.textContent = '对准二维码 / 条形码';
}

function resumeScanning(): void {
  pipeline?.resetTier();
  pipeline?.start();
}

function stopScanning(): void {
  pipeline?.stop();
  camera.stop();
}

function updateEngineBadge(): void {
  if (!scanner) return;
  const kind = scanner.engineKind;
  engineBadge.textContent =
    kind === 'native' ? '原生引擎' : kind === 'wasm' ? 'WASM 引擎' : '…';
  // WASM 实际加载后（首次 detect）再刷新一次徽标
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
  permTitle.textContent = title;
  permDesc.textContent = desc;
  permSheet.hidden = false;
}

/* ---------- 事件绑定 ---------- */
$('btn-start').onclick = () => void startScanning();
$('btn-back').onclick = () => {
  stopScanning();
  closeSheets();
  show(homeView);
};
$('btn-flip').onclick = async () => {
  const torch = await camera.flip(video).catch(() => ({ supported: false }));
  btnTorch.hidden = !torch.supported;
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

btnCopy.onclick = () => void copyResult();
$('btn-rescan').onclick = () => {
  closeSheet(resultSheet);
  resumeScanning();
};
btnOpen.onclick = () => {
  /* 新窗口打开由 target=_blank 处理 */
};

$('btn-history').onclick = () => {
  renderHistory();
  historySheet.hidden = false;
};
$('btn-history-close').onclick = () => closeSheet(historySheet);

$('btn-perm-retry').onclick = () => {
  closeSheet(permSheet);
  void startScanning();
};
$('btn-perm-close').onclick = () => closeSheet(permSheet);

document.querySelectorAll('.sheet__backdrop').forEach((b) => {
  (b as HTMLElement).onclick = () => closeAllSheetsExceptNone();
});
function closeAllSheetsExceptNone(): void {
  // 点背景关闭非结果类 Sheet；结果 Sheet 需显式操作避免误触
  [historySheet, permSheet].forEach(closeSheet);
}

$('file-input').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  scanHint.textContent = '正在识别图片…';
  try {
    const results = await scanImageFile(file);
    if (results.length > 0) {
      vibrate();
      presentResults(results);
    } else {
      alert('未能识别出条码，请尝试更清晰的照片');
    }
  } finally {
    input.value = '';
  }
};

/* 切后台自动停流省电，回来自动恢复 */
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    camera.setTorch(false);
    if (!scanView.classList.contains('view--active')) return;
    pipeline?.stop();
  } else if (
    scanView.classList.contains('view--active') &&
    resultSheet.hidden &&
    !video.paused
  ) {
    resumeScanning();
  }
});

function closeSheets(): void {
  [resultSheet, historySheet, permSheet].forEach((s) => (s.hidden = true));
}

/* 启动即探测引擎能力，首屏零成本预热判定链 */
ScannerAdapter.create().then((s) => {
  scanner = s;
  updateEngineBadge();
});
