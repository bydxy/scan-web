/** 轻量提示与音效 */

let toastEl: HTMLElement | null = null;
let timer = 0;

export function toast(msg: string, duration = 1800): void {
  if (!toastEl) {
    toastEl = document.createElement('div');
    document.body.appendChild(toastEl);
  }
  toastEl.className = 'app-toast';
  toastEl.textContent = msg;
  toastEl.style.opacity = '1';
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    if (toastEl) toastEl.style.opacity = '0';
  }, duration);
}

export function vibrate(pattern: number | number[] = 30): void {
  navigator.vibrate?.(pattern);
}

let audioCtx: AudioContext | null = null;

export function beep(): void {
  try {
    audioCtx ??= new AudioContext();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain).connect(audioCtx.destination);
    osc.frequency.value = 1180;
    gain.gain.setValueAtTime(0.12, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.12);
    osc.start();
    osc.stop(audioCtx.currentTime + 0.13);
  } catch {
    /* 音频不可用静默 */
  }
}
