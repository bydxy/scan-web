import * as history from '../history.js';
import { prettyFormat } from '../formats.js';
import { toast } from './feedback.js';
import { showScreen } from './router.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface HistoryHooks {
  onGenerateQr: (text: string) => void;
  onPick: (text: string, format: string) => void;
}

interface FilterState {
  query: string;
  kind: string;
  format: string;
  range: 'all' | 'today' | 'week';
  favOnly: boolean;
}

const filter: FilterState = { query: '', kind: '', format: '', range: 'all', favOnly: false };

/** 打开历史页面（安卓二级屏） */
export function openHistoryPage(hooks: HistoryHooks): void {
  buildFormatOptions();
  bindOnce(hooks);
  render(hooks);
  showScreen('s-history');
}

function buildFormatOptions(): void {
  const sel = $<HTMLSelectElement>('h-format');
  const formats = new Set<string>();
  for (const it of history.query()) formats.add(it.format);
  const current = sel.value;
  sel.innerHTML = '<option value="">全部格式</option>';
  for (const f of [...formats].sort()) {
    const opt = document.createElement('option');
    opt.value = f;
    opt.textContent = prettyFormat(f);
    sel.appendChild(opt);
  }
  sel.value = current;
}

let bound = false;

function bindOnce(hooks: HistoryHooks): void {
  if (bound) return;
  bound = true;

  const rerender = () => render(hooks);
  $('h-search').oninput = (e) => ((filter.query = (e.target as HTMLInputElement).value), rerender());
  $('h-kind').onchange = (e) => ((filter.kind = (e.target as HTMLSelectElement).value), rerender());
  $('h-format').onchange = (e) => ((filter.format = (e.target as HTMLSelectElement).value), rerender());
  $('h-range').onchange = (e) =>
    ((filter.range = (e.target as HTMLSelectElement).value as FilterState['range']), rerender());
  $('h-fav').onclick = (e) => {
    filter.favOnly = !filter.favOnly;
    (e.currentTarget as HTMLElement).classList.toggle('on', filter.favOnly);
    rerender();
  };

  $('h-export-json').onclick = () => history.exportJSON();
  $('h-export-csv').onclick = () => history.exportCSV();
  $('h-clear').onclick = () => {
    if (confirm('清除全部未收藏记录？')) {
      history.query().filter((i) => !i.fav).forEach((i) => history.remove(i.id));
      toast('已清除未收藏记录');
      render(hooks);
    }
  };
}

function render(hooks: HistoryHooks): void {
  const list = $<HTMLUListElement>('history-list');
  list.innerHTML = '';
  const items = history.query(filter);

  if (items.length === 0) {
    list.innerHTML = '<li><div class="h-text">暂无匹配记录</div></li>';
    return;
  }

  for (const it of items) {
    const li = document.createElement('li');
    li.className = 'h-item';

    const row = document.createElement('div');
    row.className = 'h-row';

    const main = document.createElement('div');
    main.style.flex = '1';
    main.style.minWidth = '0';
    const textDiv = document.createElement('div');
    textDiv.className = 'h-text clampable';
    if (it.text.length > 60) {
      textDiv.onclick = () => textDiv.classList.toggle('expanded');
    }
    textDiv.textContent = it.text;
    const meta = document.createElement('div');
    meta.className = 'h-meta';
    meta.textContent = `${it.fav ? '★ ' : ''}${prettyFormat(it.format)} · ${new Date(it.at).toLocaleString()}${it.note ? ` · 📝${it.note}` : ''}`;
    main.append(textDiv, meta);

    const ops = document.createElement('div');
    ops.className = 'h-ops';

    const mkBtn = (label: string, fn: () => void) => {
      const b = document.createElement('button');
      b.className = 'mini-btn';
      b.textContent = label;
      b.onclick = fn;
      ops.appendChild(b);
    };

    mkBtn(it.fav ? '★' : '☆', () => {
      history.toggleFav(it.id);
      render(hooks);
    });
    mkBtn('二维码', () => hooks.onGenerateQr(it.text));
    mkBtn('备注', () => {
      const note = prompt('为这条记录添加备注：', it.note ?? '');
      if (note !== null) {
        history.setNote(it.id, note.trim());
        render(hooks);
      }
    });
    mkBtn('删', () => {
      history.remove(it.id);
      render(hooks);
    });
    mkBtn('使用', () => {
      hooks.onPick(it.text, it.format);
    });

    // 长文本点击展开/折叠
    if (it.text.length > 60) {
      textDiv.onclick = () => textDiv.classList.toggle('expanded');
    }

    row.append(main, ops);
    li.appendChild(row);
    list.appendChild(li);
  }
}

/** 供设置页调用 */
export function runAutoClean(days: number): void {
  const n = history.autoClean(days);
  if (n > 0) toast(`已自动清理 ${n} 条过期记录`);
}
