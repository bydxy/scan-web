import './style.css';
import { CameraManager } from './camera.js';
import { FramePipeline } from './pipeline.js';
import type { FrameHits } from './pipeline.js';
import { ScannerAdapter, scanImageFile } from './scanner/index.js';
import type { ScanResult } from './scanner/index.js';
import { classify, activate } from './apps.js';

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
const btnApp = $<HTMLButtonElement>('btn-app');
const btnOpen = $<HTMLAnchorElement>('btn-open');
const btnCopy = $<HTMLButtonElement>('btn-copy');
const historySheet = $<HTMLElement>('history-sheet');
const historyList = $<HTMLUListElement>('history-list');
const permSheet = $<HTMLElement>('perm-sheet');
const permTitle = $<HTMLElement>('perm-title');
const permDesc = $<HTMLElement>('perm-desc');

const camera = new CameraManager();
let scanner: ScannerAdapter | null = null;
let pipeline: FramePipeline | null = null;
let torchOn = false;

/* ============================================================
   实时跟踪标注层：SVG 四边形描边（贴着码的四个角，随大小伸缩）
   + 内容 chip（骑在码框上方，随码移动）
   ============================================================ */
const SVG_NS = 'http://www.w3.org/2000/svg';

interface LabelState {
  outline: SVGPolygonElement;
  chip: HTMLElement;
  lastSeen: number;
}
const labels = new Map<string, LabelState>();

const outlineSvg = document.createElementNS(SVG_NS, 'svg');
outlineSvg.id = 'outline-layer';
const chipLayer = document.createElement('div');
chipLayer.id = 'chip-layer';

/** 解码画面像素坐标 → 屏幕 CSS 坐标（逆推 grab 缩放 + cover 变换） */
function roiToScreen(
  px: number,
  py: number,
  src: { x: number; y: number; w: number; h: number },
  out: { w: number; h: number }
): [number, number] {
  const vw = video.videoWidth;
  const vh = video.videoHeight;
  if (!vw || !vh) return [-9999, -9999];
  const vx = src.x + (px / out.w) * src.w;
  const vy = src.y + (py / out.h) * src.h;
  const cw = window.innerWidth;
  const ch = window.innerHeight;
  const s = Math.max(cw / vw, ch / vh);
  const ox = (cw - vw * s) / 2;
  const oy = (ch - vh * s) / 2;
  return [vx * s + ox, vy * s + oy];
}

function ensureLabel(text: string): LabelState {
  let st = labels.get(text);
  if (!st) {
    const outline = document.createElementNS(SVG_NS, 'polygon');
    outline.classList.add('code-outline');

    const chip = document.createElement('div');
    chip.className = 'code-chip';
    chip.onclick = () => {
      const r = currentHits.get(text);
      if (r) presentResults(r);
    };

    outlineSvg.appendChild(outline);
    chipLayer.appendChild(chip);
    st = { outline, chip, lastSeen: Date.now() };
    labels.set(text, st);
  }
  return st;
}

/** 本帧结果缓存：chip 点击时取最新内容 */
const currentHits = new Map<string, ScanResult>();

function updateLabels(hits: FrameHits): void {
  const now = Date.now();
  let newCodeFound = false;

  for (const r of hits.results) {
    if (!r.corners?.length) continue;
    const pts = r.corners.map((c) => roiToScreen(c.x, c.y, hits.src, hits.out));
    if (pts.some(([x]) => x < -999)) continue;

    currentHits.set(r.text, r);
    const isNew = !labels.has(r.text);
    const st = ensureLabel(r.text);
    if (isNew) newCodeFound = true;

    // 描边贴四个角：旋转/透视变形的码也能包住
    st.outline.setAttribute(
      'points',
      pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
    );

    // chip 骑在包围盒上方；顶部空间不足则落到下方
    const xs = pts.map(([x]) => x);
    const ys = pts.map(([, y]) => y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const resolved = classify(r.text);
    st.chip.textContent = resolved.display;
    const above = minY > 64;
    st.chip.style.top = `${above ? minY - 44 : maxY + 10}px`;
    st.chip.style.left = `${(minX + maxX) / 2}px`;
    st.lastSeen = now;
  }

  // 800ms 未再见 → 移除
  for (const [text, st] of labels) {
    if (now - st.lastSeen > 800) {
      st.outline.remove();
      st.chip.remove();
      labels.delete(text);
      currentHits.delete(text);
    }
  }

  if (newCodeFound) vibrate();
}

function clearLabels(): void {
  labels.forEach((s) => {
    s.outline.remove();
    s.chip.remove();
  });
  labels.clear();
  currentHits.clear();
}

/* ---------- 历史 ---------- */
const HISTORY_KEY = 'scan-web.history.v1';

interface HistoryItem {
  text: string;
  format: string;
  at: number;
}

function loadHistory(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function saveHistory(results: ScanResult[]): void {
  const items = loadHistory();
  let changed = false;
  for (const r of results) {
    if (!items.some((i) => i.text === r.text)) {
      items.unshift({ ...r, at: Date.now() });
      changed = true;
    }
  }
  if (changed) localStorage.setItem(HISTORY_KEY, JSON.stringify(items.slice(0, 20)));
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
      presentResults({ text: item.text, format: item.format, corners: [] });
    };
    historyList.appendChild(li);
  }
}

/* ---------- 结果呈现 ---------- */
function presentResults(r: ScanResult): void {
  const resolved = classify(r.text);

  // 标题：App 名 > 域名 > 类型名
  resultType.textContent =
    resolved.kind === 'app'
      ? resolved.appName!
      : resolved.kind === 'url'
        ? `网页 · ${resolved.display}`
        : resolved.kind === 'tel'
          ? '电话号码'
          : resolved.kind === 'mailto'
            ? '邮件'
            : '文本内容';
  resultText.textContent = r.text;

  // 主按钮：打开 App / 拨号 / 复制
  if (resolved.kind === 'app') {
    btnApp.hidden = false;
    btnApp.textContent = resolved.scheme ? `打开${resolved.appName}` : `访问${resolved.appName}`;
    btnApp.onclick = () => activate(resolved);
  } else if (resolved.kind === 'tel' || resolved.kind === 'mailto') {
    btnApp.hidden = false;
    btnApp.textContent = resolved.kind === 'tel' ? '拨打电话' : '发邮件';
    btnApp.onclick = () => activate(resolved);
  } else if (resolved.webUrl) {
    btnApp.hidden = false;
    btnApp.textContent = '打开链接';
    btnApp.onclick = () => activate(resolved);
  } else {
    // 纯文本：一键复制即主操作
    btnApp.hidden = false;
    btnApp.textContent = '一键复制';
    btnApp.onclick = () => void copyResult(true);
  }

  const isHttp = !!resolved.webUrl && /^https?:\/\//i.test(resolved.webUrl);
  btnOpen.hidden = !isHttp;
  if (isHttp) btnOpen.href = resolved.webUrl!;

  saveHistory([r]);
  resultSheet.hidden = false;
}

function vibrate(): void {
  navigator.vibrate?.(30);
}

async function copyResult(asPrimary = false): Promise<void> {
  try {
    await navigator.clipboard.writeText(resultText.textContent ?? '');
    const original = asPrimary ? btnApp.textContent : btnCopy.textContent;
    if (asPrimary) {
      btnApp.textContent = '已复制 ✓';
    } else {
      btnCopy.textContent = '已复制 ✓';
    }
    setTimeout(() => {
      if (asPrimary) btnApp.textContent = original ?? '一键复制';
      else btnCopy.textContent = original ?? '复制';
    }, 1200);
  } catch {
    /* 剪贴板不可用时静默 */
  }
}

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

  pipeline ??= new FramePipeline(video, canvas, scanner, (hits) => {
    updateLabels(hits);
    saveHistory(hits.results);
  });
  pipeline.start();
  scanView.append(outlineSvg, chipLayer);
  show(scanView);
  scanHint.textContent = '全屏识别 · 点按标注查看详情';
}

function resumeScanning(): void {
  pipeline?.resetTier();
  pipeline?.start();
}

function stopScanning(): void {
  pipeline?.stop();
  camera.stop();
  clearLabels();
}

function updateEngineBadge(): void {
  if (!scanner) return;
  const kind = scanner.engineKind;
  engineBadge.textContent =
    kind === 'native' ? '原生引擎' : kind === 'wasm' ? 'WASM 引擎' : '…';
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
  (b as HTMLElement).onclick = () => [historySheet, permSheet].forEach(closeSheet);
});

$('file-input').onchange = async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  try {
    const results = await scanImageFile(file);
    if (results.length > 0) {
      vibrate();
      presentResults(results[0]);
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

window.addEventListener('resize', clearLabels);

function show(view: HTMLElement): void {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('view--active'));
  view.classList.add('view--active');
}

function closeSheet(sheet: HTMLElement): void {
  sheet.hidden = true;
}

function closeSheets(): void {
  [resultSheet, historySheet, permSheet].forEach((s) => (s.hidden = true));
}

/* 启动即探测引擎能力，首屏零成本预热判定链 */
ScannerAdapter.create().then((s) => {
  scanner = s;
  updateEngineBadge();
});

/* PWA：生产环境注册 Service Worker（离线壳 + 二次进入零下载） */
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => undefined);
  });
}
