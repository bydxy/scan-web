/** 应用设置：本地存储 + 应用到 DOM（主题/低性能降级） */

export interface Settings {
  saveHistory: boolean;
  autoCleanDays: number;
  sound: boolean;
  vibrate: boolean;
  autoOpen: boolean;
  mode: 'continuous' | 'single';
  area: 'viewfinder' | 'full';
  group: 'all' | 'qr' | 'barcode';
  theme: 'auto' | 'dark' | 'light';
  lowPerf: 'auto' | 'on' | 'off';
}

const KEY = 'scan-web.settings.v1';

export const DEFAULTS: Settings = {
  saveHistory: true,
  autoCleanDays: 0,
  sound: false,
  vibrate: true,
  autoOpen: false,
  mode: 'continuous',
  area: 'viewfinder',
  group: 'all',
  theme: 'auto',
  lowPerf: 'auto',
};

let cache: Settings | null = null;

export function getSettings(): Settings {
  if (cache) return cache;
  try {
    cache = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') };
  } catch {
    cache = { ...DEFAULTS };
  }
  return cache!;
}

export function updateSettings(patch: Partial<Settings>): Settings {
  const s = { ...getSettings(), ...patch };
  localStorage.setItem(KEY, JSON.stringify(s));
  cache = s;
  applySettings(s);
  return s;
}

/** 设备低性能判定：内存 ≤4GB 或核心数 ≤4 */
export function isLowEndDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.deviceMemory ?? 8) <= 4 || (navigator.hardwareConcurrency ?? 8) <= 4;
}

export function applySettings(s: Settings = getSettings()): void {
  const root = document.documentElement;
  root.dataset.theme = s.theme;
  const low =
    s.lowPerf === 'on' || (s.lowPerf === 'auto' && isLowEndDevice());
  root.classList.toggle('low-perf', low);
}
