import type { FrameHits } from '../pipeline.js';
import type { ScanResult } from '../scanner/index.js';
import { classify } from '../apps.js';
import { prettyFormat } from '../formats.js';

/**
 * 空间化标注层：SVG 描边贴码四角（随大小/位置/旋转变化）
 * + 内容 chip 骑在包围盒上方。
 */
const SVG_NS = 'http://www.w3.org/2000/svg';

interface LabelState {
  outline: SVGPolygonElement;
  chip: HTMLElement;
  lastSeen: number;
}

export class LabelOverlay {
  private labels = new Map<string, LabelState>();
  private currentHits = new Map<string, ScanResult>();
  private svg = document.createElementNS(SVG_NS, 'svg');
  private chipLayer = document.createElement('div');

  constructor(
    private video: HTMLVideoElement,
    private onPick: (r: ScanResult) => void
  ) {
    this.svg.id = 'outline-layer';
    this.chipLayer.id = 'chip-layer';
  }

  mount(parent: HTMLElement): void {
    parent.append(this.svg, this.chipLayer);
  }

  update(hits: FrameHits): void {
    const now = Date.now();
    let newCodeFound = false;

    for (const r of hits.results) {
      if (!r.corners?.length) continue;
      const pts = r.corners.map((c) =>
        this.roiToScreen(c.x, c.y, hits.src, hits.out)
      );
      if (pts.some(([x]) => x < -999)) continue;

      this.currentHits.set(r.text, r);
      const isNew = !this.labels.has(r.text);
      const st = this.ensure(r.text);
      if (isNew) newCodeFound = true;

      st.outline.setAttribute(
        'points',
        pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
      );

      const xs = pts.map(([x]) => x);
      const ys = pts.map(([, y]) => y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);

      st.chip.textContent = classify(r.text).display;
      const above = minY > 64;
      st.chip.style.top = `${above ? minY - 44 : maxY + 10}px`;
      st.chip.style.left = `${(minX + maxX) / 2}px`;
      st.lastSeen = now;
    }

    for (const [text, st] of this.labels) {
      if (now - st.lastSeen > 800) {
        st.outline.remove();
        st.chip.remove();
        this.labels.delete(text);
        this.currentHits.delete(text);
      }
    }

    return void newCodeFound;
  }

  /** 是否发现了新码（供反馈层判断震动/提示音） */
  consumedNewCode = false;

  clear(): void {
    this.labels.forEach((s) => {
      s.outline.remove();
      s.chip.remove();
    });
    this.labels.clear();
    this.currentHits.clear();
  }

  getLatest(text: string): ScanResult | undefined {
    return this.currentHits.get(text);
  }

  all(): ScanResult[] {
    return [...this.currentHits.values()];
  }

  private ensure(text: string): LabelState {
    let st = this.labels.get(text);
    if (!st) {
      const outline = document.createElementNS(SVG_NS, 'polygon');
      outline.classList.add('code-outline');
      const chip = document.createElement('div');
      chip.className = 'code-chip';
      chip.onclick = () => {
        const r = this.currentHits.get(text);
        if (r) this.onPick(r);
      };
      this.svg.appendChild(outline);
      this.chipLayer.appendChild(chip);
      st = { outline, chip, lastSeen: Date.now() };
      this.labels.set(text, st);
    }
    return st;
  }

  private roiToScreen(
    px: number,
    py: number,
    src: { x: number; y: number; w: number; h: number },
    out: { w: number; h: number }
  ): [number, number] {
    const vw = this.video.videoWidth;
    const vh = this.video.videoHeight;
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
}

export function formatBadgeText(format: string): string {
  return prettyFormat(format);
}
