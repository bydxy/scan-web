export type CameraErrorCode =
  | 'INSECURE_CONTEXT'
  | 'NO_MEDIA_DEVICES'
  | 'PERMISSION_DENIED'
  | 'NO_DEVICE'
  | 'DEVICE_BUSY'
  | 'REQUEST_FAILED';

export interface TorchCapability {
  supported: boolean;
}

/**
 * 相机管理：手势触发启动（iOS Safari 要求）、能力检测、前后切换。
 * 约束采用 ideal 而非 exact——不因个别设备不满足而整体失败。
 */
export class CameraManager {
  private stream: MediaStream | null = null;
  private facing: 'environment' | 'user' = 'environment';

  get track(): MediaStreamTrack | null {
    return this.stream?.getVideoTracks()[0] ?? null;
  }

  async start(video: HTMLVideoElement): Promise<TorchCapability> {
    this.stop();
    if (!window.isSecureContext) throw err('INSECURE_CONTEXT');
    if (!navigator.mediaDevices?.getUserMedia) throw err('NO_MEDIA_DEVICES');

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: this.facing },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
      });
    } catch (e) {
      throw err(mapError(e));
    }

    const track = this.track!;
    video.srcObject = this.stream;
    // 等首帧就绪再进入抽帧，避免黑屏期空转
    await new Promise<void>((resolve) => {
      if (video.readyState >= 2) return resolve();
      video.onloadeddata = () => resolve();
    });
    await video.play().catch(() => undefined);

    return { supported: 'torch' in (track.getCapabilities?.() ?? {}) };
  }

  /** 切换前后镜头并重新拉流 */
  async flip(video: HTMLVideoElement): Promise<TorchCapability> {
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

  stop(): void {
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
