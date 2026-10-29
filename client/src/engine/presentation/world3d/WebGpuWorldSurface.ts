import { WebGpuWorldRenderer } from './WebGpuWorldRenderer';
import type { World3dFrame } from './WebGpuWorldRenderer';
import type { PresentationStatus } from './visualContract';

/** The original canvas remains the untouched full-resolution UI/input surface. */
export class WebGpuWorldSurface {
  readonly renderer: WebGpuWorldRenderer;
  readonly worldCanvas: HTMLCanvasElement;
  private readonly originalZIndex: string;
  private disposal: Promise<void> | null = null;

  constructor(readonly canvas: HTMLCanvasElement, onStatus: (status: PresentationStatus) => void) {
    this.worldCanvas = document.createElement('canvas');
    this.worldCanvas.dataset.worldPresentation = 'webgpu';
    this.worldCanvas.setAttribute('aria-hidden', 'true');
    Object.assign(this.worldCanvas.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', zIndex: '0' });
    this.originalZIndex = canvas.style.zIndex;
    canvas.style.zIndex = '1';
    canvas.parentNode?.insertBefore(this.worldCanvas, canvas);
    this.renderer = new WebGpuWorldRenderer(this.worldCanvas, onStatus);
  }

  render(frame: World3dFrame): void {
    // Existing visual settings still control the world without changing their UI.
    this.worldCanvas.style.filter = this.canvas.style.filter;
    this.renderer.render(frame);
  }

  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    // Restore DOM ownership synchronously before a StrictMode remount can start.
    this.worldCanvas.remove();
    this.canvas.style.zIndex = this.originalZIndex;
    this.disposal = this.renderer.dispose();
    return this.disposal;
  }
}
