import type { ScanResult } from '../scanner/index.js';
import { classify, openWeb } from '../apps.js';
import { prettyFormat, isQrFamily } from '../formats.js';
import { toast } from './feedback.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface ResultHooks {
  onGenerateQr: (text: string) => void;
  onExportJson: () => void;
}

let current: ScanResult[] = [];

export function presentResults(results: ScanResult[], hooks: ResultHooks): void {
  current = results;
  const list = $<HTMLUListElement>('result-list');
  list.innerHTML = '';

  $<HTMLElement>('result-count').textContent =
    results.length > 1 ? `识别到 ${results.length} 个码` : '识别结果';

  for (const r of results) {
    const resolved = classify(r.text);
    const li = document.createElement('li');

    const textDiv = document.createElement('div');
    textDiv.className = 'r-text';
    if (r.text.length > 60) {
      textDiv.classList.add('clampable');
      textDiv.onclick = () => textDiv.classList.toggle('expanded');
      textDiv.title = '点击展开/折叠';
    }
    textDiv.textContent = r.text;

    const meta = document.createElement('div');
    meta.className = 'r-meta';
    const badge = document.createElement('span');
    badge.className = `badge badge--${resolved.kind === 'app' ? 'app' : resolved.kind === 'url' ? 'url' : 'text'}`;
    badge.textContent =
      resolved.kind === 'app'
        ? resolved.appName!
        : resolved.kind === 'url'
          ? '链接'
          : prettyFormat(r.format);
    meta.appendChild(badge);
    meta.appendChild(document.createTextNode(prettyFormat(r.format)));
    if (resolved.risk) {
      const risk = document.createElement('span');
      risk.className = 'badge badge--risk';
      risk.textContent = `⚠ ${resolved.risk}`;
      meta.appendChild(risk);
    }

    const actions = document.createElement('div');
    actions.className = 'r-actions';

    // 快捷动作（打开 App / 拨号 / 复制密码…）
    for (const a of resolved.actions ?? []) {
      const btn = document.createElement('button');
      btn.className = 'mini-btn';
      btn.textContent = a.label;
      btn.onclick = () => a.run();
      actions.appendChild(btn);
    }
    if (!resolved.actions?.some((a) => /^复制/.test(a.label))) {
      addMini(actions, '复制', () => {
        navigator.clipboard.writeText(r.text).then(
          () => toast('已复制'),
          () => toast('复制失败')
        );
      });
    }
    if (resolved.webUrl && /^https?:\/\//i.test(resolved.webUrl)) {
      addMini(actions, '浏览器打开', () => openWeb(resolved.webUrl!));
    }
    if (isQrFamily(r.format)) {
      addMini(actions, '生成二维码', () => hooks.onGenerateQr(r.text));
    }

    li.append(textDiv, meta, actions);
    list.appendChild(li);
  }

  $<HTMLElement>('result-sheet').hidden = false;
}

function addMini(parent: HTMLElement, label: string, onClick: () => void): void {
  const b = document.createElement('button');
  b.className = 'mini-btn';
  b.textContent = label;
  b.onclick = onClick;
  parent.appendChild(b);
}

export function getCurrentResults(): ScanResult[] {
  return current;
}

export function bindBatchActions(hooks: ResultHooks): void {
  $('btn-batch-copy').onclick = () => {
    navigator.clipboard
      .writeText(current.map((r) => r.text).join('\n'))
      .then(() => toast(`已复制 ${current.length} 条`),
        () => toast('复制失败'));
  };
  $('btn-batch-share').onclick = async () => {
    const text = current.map((r) => r.text).join('\n');
    try {
      if (navigator.share) await navigator.share({ title: '扫码结果', text });
      else await navigator.clipboard.writeText(text), toast('已复制（设备不支持分享）');
    } catch {
      /* 用户取消 */
    }
  };
  $('btn-export-json').onclick = hooks.onExportJson;
}
