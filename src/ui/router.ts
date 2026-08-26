/** 屏幕路由 + Material 涟漪反馈 */

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export type ScreenId = 's-scan' | 's-history' | 's-settings';

export function showScreen(id: ScreenId): void {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  $(id).classList.add('active');
}

/** 相机页沉浸控件显隐 */
export function setScanUiActive(active: boolean): void {
  ['scan-top', 'scan-dock'].forEach((id) => ($<HTMLElement>(id).hidden = !active));
}

/** 全局涟漪：所有 [data-ripple] 元素点击时注入墨水层 */
export function initRipple(): void {
  document.addEventListener('pointerdown', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-ripple]');
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const ink = document.createElement('span');
    const size = Math.max(rect.width, rect.height);
    ink.className = 'ripple-ink';
    ink.style.width = ink.style.height = `${size}px`;
    ink.style.left = `${e.clientX - rect.left - size / 2}px`;
    ink.style.top = `${e.clientY - rect.top - size / 2}px`;
    target.appendChild(ink);
    setTimeout(() => ink.remove(), 500);
  }, { passive: true });
}
