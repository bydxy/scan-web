export type CameraErrorCode =
  | 'INSECURE_CONTEXT'
  | 'NO_MEDIA_DEVICES'
  | 'PERMISSION_DENIED'
  | 'NO_DEVICE'
  | 'DEVICE_BUSY'
  | 'REQUEST_FAILED';

export interface CameraCapabilities {
  torch: boolean;
  zoom: { min: number; max: number; step: number; value: number } | null;
}

/**
 * 相机管理：手势触发、能力检测（torch/zoom）、断流自动恢复。
 */
export class CameraManager {
  private stream: MediaStream | null = null;
  private facing: 'environment' | 'user' = 'environment';
  private video: HTMLVideoElement | null = null;
  private retryCount = 0;
  onStreamLost?: () => void;

  get track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  async start(video: HTMLVideoElement): Promise<CameraCapabilities> {
    this.video = video;
    this.stop();
    if (!window.isSecureContext) throw err('INSECURE_CONTEXT');
    if (!navigator.mediaDevices?.getUserMedia) throw err('NO_MEDIA_DEVICES');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: this.facing },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
      });
    } catch (e) {
      throw err(mapError(e));
    }

    const track = this.track!;
    track.onended = () => this.recover();

    video.srcObject = this.stream;
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) return resolve();
      video.onloadeddata = () => resolve();
    });
    await video.play().catch(() => undefined);
    this.retryCount = 0;

    const caps = track.getCapabilities?.() as MediaTrackCapabilities & {
      torch?: boolean;
      zoom?: { min: number; max: number; step: number };
    };
    const zoom = caps.zoom
      ? {
          min: caps.zoom.min,
          max: caps.zoom.max,
          step: caps.zoom.step || 0.1,
          value: (track.getSettings() as MediaTrackSettings & { zoom?: number }).zoom ?? caps.zoom.min,
        }
      : null;
    return { torch: 'torch' in (caps ?? {}), zoom };
  }

  /** 断流恢复：指数退避重试，最多 3 次 */
  private async recover(): Promise<void> {
    if (!this.video || this.retryCount >= 3) {
      this.onStreamLost?.();
      return;
    }
    this.retryCount++;
    const delay = 800 * 2 ** (this.retryCount - 1);
    setTimeout(async () => {
      try {
        await this.start(this.video!);
      } catch {
        void this.recover();
      }
    }, delay);
  }

  async flip(video: HTMLVideoElement): Promise<CameraCapabilities> {
    this.facing = this.facing === 'environment' ? 'user' : 'environment';
    return this.start(video);
  }

  setTorch(on: boolean): void {
    this.track
      ?.applyConstraints({
        advanced: [{ torch: on } as unknown as MediaTrackConstraintSet],
      })
      .catch(() => undefined);
  }

  setZoom(value: number): void {
    this.track
      ?.applyConstraints({
        advanced: [{ zoom: value } as unknown as MediaTrackConstraintSet],
      })
      .catch(() => undefined);
  }

  stop(): void {
    if (this.track) this.track.onended = null;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
}

function err(code: CameraErrorCode): Error {
  const e = new Error(code);
  e.name = code;
  return e;
}

function mapError(e: unknown): CameraErrorCode {
  const name = e instanceof DOMException ? e.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'PERMISSION_DENIED';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'NO_DEVICE';
    case 'NotReadableError':
    case 'AbortError':
      return 'DEVICE_BUSY';
    default:
      return 'REQUEST_FAILED';
  }
}
