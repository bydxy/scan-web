/** 富历史记录：收藏/备注/搜索/筛选/导出/清理，仅存本机 */

export interface HistoryItem {
  id: string;
  text: string;
  format: string;
  kind:
    | 'app' | 'url' | 'text' | 'tel' | 'mailto'
    | 'wifi' | 'vcard' | 'event' | 'product';
  at: number;
  fav: boolean;
  note?: string;
}

const KEY = 'scan-web.history.v2';
const MAX = 500;

function load(): HistoryItem[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

function save(items: HistoryItem[]): void {
  const kept = items.slice(0, MAX);
  localStorage.setItem(KEY, JSON.stringify(kept));
  cache = kept;
}

let cache: HistoryItem[] | null = null;

function all(): HistoryItem[] {
  if (!cache) cache = load();
  return cache!;
}

export function add(
  text: string,
  format: string,
  kind: HistoryItem['kind'],
  at: number = Date.now()
): boolean {
  const items = all();
  if (items.some((i) => i.text === text)) return false;
  items.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    text,
    format,
    kind,
    at,
    fav: false,
  });
  save(items);
  return true;
}

export function has(text: string): boolean {
  return all().some((i) => i.text === text);
}

export interface HistoryFilter {
  query?: string;
  kind?: string;
  format?: string;
  range?: 'all' | 'today' | 'week';
  favOnly?: boolean;
}

export function query(f: HistoryFilter = {}): HistoryItem[] {
  let items = all();
  const now = Date.now();
  if (f.range === 'today') {
    const start = new Date().setHours(0, 0, 0, 0);
    items = items.filter((i) => i.at >= start);
  } else if (f.range === 'week') {
    items = items.filter((i) => i.at >= now - 7 * 864e5);
  }
  if (f.favOnly) items = items.filter((i) => i.fav);
  if (f.kind) items = items.filter((i) => i.kind === f.kind);
  if (f.format) items = items.filter((i) => i.format === f.format);
  if (f.query) {
    const q = f.query.toLowerCase();
    items = items.filter(
      (i) =>
        i.text.toLowerCase().includes(q) ||
        (i.note ?? '').toLowerCase().includes(q)
    );
  }
  return items;
}

export function toggleFav(id: string): void {
  const items = all();
  const it = items.find((i) => i.id === id);
  if (it) {
    it.fav = !it.fav;
    save(items);
  }
}

export function setNote(id: string, note: string): void {
  const items = all();
  const it = items.find((i) => i.id === id);
  if (it) {
    it.note = note || undefined;
    save(items);
  }
}

export function remove(id: string): void {
  save(all().filter((i) => i.id !== id));
}

export function clearAll(): void {
  save([]);
}

/** 自动清理：超过 N 天的非收藏记录，返回清理数量 */
export function autoClean(days: number): number {
  if (!days) return 0;
  const cutoff = Date.now() - days * 864e5;
  const items = all();
  const kept = items.filter((i) => i.fav || i.at >= cutoff);
  const removed = items.length - kept.length;
  if (removed) save(kept);
  return removed;
}

function download(name: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 3000);
}

export function exportJSON(): void {
  download(
    `scan-history-${Date.now()}.json`,
    'application/json',
    JSON.stringify(all(), null, 2)
  );
}

export function exportCSV(): void {
  const esc = (v: string) => `"${String(v).replace(/"/g, '""')}"`;
  const rows = [
    ['time', 'kind', 'format', 'fav', 'note', 'text'].join(','),
    ...all().map((i) =>
      [
        new Date(i.at).toISOString(),
        i.kind,
        i.format,
        i.fav ? 1 : 0,
        esc(i.note ?? ''),
        esc(i.text),
      ].join(',')
    ),
  ];
  download(
    `scan-history-${Date.now()}.csv`,
    'text/csv',
    '\ufeff' + rows.join('\n')
  );
}
