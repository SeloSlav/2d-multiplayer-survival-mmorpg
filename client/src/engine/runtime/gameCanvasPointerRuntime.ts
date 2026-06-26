export interface GameCanvasPointerPosition {
  x: number | null;
  y: number | null;
}

export interface GameCanvasPointerSnapshot {
  screenMousePos: GameCanvasPointerPosition;
  worldMousePos: GameCanvasPointerPosition;
  canvasMousePos: GameCanvasPointerPosition;
}

export interface GameCanvasPointerRuntimeOptions {
  canvasRef: { current: HTMLCanvasElement | null };
  cameraOffsetX: number;
  cameraOffsetY: number;
  canvasSize: { width: number; height: number };
  isMobile?: boolean;
  onMobileTap?: (worldX: number, worldY: number) => void;
}

const EMPTY_POINTER_POSITION: GameCanvasPointerPosition = { x: null, y: null };

export class GameCanvasPointerRuntime {
  private canvas: HTMLCanvasElement | null = null;
  private options: GameCanvasPointerRuntimeOptions | null = null;
  private lastClientMouse: { x: number; y: number } | null = null;
  private isMobile = false;
  private cameraOffset = { x: 0, y: 0 };
  private readonly snapshot: GameCanvasPointerSnapshot = {
    screenMousePos: EMPTY_POINTER_POSITION,
    worldMousePos: EMPTY_POINTER_POSITION,
    canvasMousePos: EMPTY_POINTER_POSITION,
  };

  configure(options: GameCanvasPointerRuntimeOptions): GameCanvasPointerSnapshot {
    const nextCanvas = options.canvasRef.current;
    const mobileChanged = this.isMobile !== !!options.isMobile;
    this.options = options;
    this.cameraOffset = { x: options.cameraOffsetX, y: options.cameraOffsetY };

    if (nextCanvas !== this.canvas || mobileChanged) {
      this.detach();
      this.canvas = nextCanvas;
      this.isMobile = !!options.isMobile;
      this.attach();
    }

    this.refreshWorldPosition(this.cameraOffset.x, this.cameraOffset.y);
    return this.snapshot;
  }

  refreshWorldPosition(cameraOffsetX: number, cameraOffsetY: number): void {
    this.cameraOffset = { x: cameraOffsetX, y: cameraOffsetY };
    if (!this.lastClientMouse || !this.canvas) {
      return;
    }

    this.updateMousePositions(this.lastClientMouse.x, this.lastClientMouse.y, cameraOffsetX, cameraOffsetY);
  }

  getSnapshot(): GameCanvasPointerSnapshot {
    return this.snapshot;
  }

  stop(): void {
    this.detach();
    this.canvas = null;
    this.options = null;
    this.lastClientMouse = null;
    this.setEmptySnapshot();
  }

  private attach(): void {
    if (!this.canvas) {
      return;
    }

    this.canvas.addEventListener('mousemove', this.handleMouseMove);
    this.canvas.addEventListener('mouseleave', this.handleMouseLeave);

    if (this.isMobile) {
      this.canvas.addEventListener('touchstart', this.handleTouchStart, { passive: false });
      this.canvas.addEventListener('touchmove', this.handleTouchMove, { passive: false });
    }
  }

  private detach(): void {
    if (!this.canvas) {
      return;
    }

    this.canvas.removeEventListener('mousemove', this.handleMouseMove);
    this.canvas.removeEventListener('mouseleave', this.handleMouseLeave);
    this.canvas.removeEventListener('touchstart', this.handleTouchStart);
    this.canvas.removeEventListener('touchmove', this.handleTouchMove);
  }

  private readonly handleMouseMove = (event: MouseEvent): void => {
    this.lastClientMouse = { x: event.clientX, y: event.clientY };
    this.updateMousePositions(event.clientX, event.clientY, this.cameraOffset.x, this.cameraOffset.y);
  };

  private readonly handleMouseLeave = (): void => {
    this.lastClientMouse = null;
    this.setEmptySnapshot();
  };

  private readonly handleTouchStart = (event: TouchEvent): void => {
    if (!this.options?.onMobileTap || event.touches.length !== 1 || !this.canvas) {
      return;
    }

    const touch = event.touches[0];
    const rect = this.canvas.getBoundingClientRect();
    const screenX = touch.clientX - rect.left;
    const screenY = touch.clientY - rect.top;
    this.options.onMobileTap(screenX - this.cameraOffset.x, screenY - this.cameraOffset.y);
    event.preventDefault();
  };

  private readonly handleTouchMove = (event: TouchEvent): void => {
    event.preventDefault();
  };

  private updateMousePositions(
    clientX: number,
    clientY: number,
    cameraOffsetX: number,
    cameraOffsetY: number,
  ): void {
    if (!this.canvas) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;

    const currentScreenX = (clientX - rect.left) * scaleX;
    const currentScreenY = (clientY - rect.top) * scaleY;
    const currentWorldX = currentScreenX - cameraOffsetX;
    const currentWorldY = currentScreenY - cameraOffsetY;
    const canvasX = currentScreenX - rect.left;
    const canvasY = currentScreenY - rect.top;

    this.snapshot.screenMousePos = { x: currentScreenX, y: currentScreenY };
    this.snapshot.worldMousePos = { x: currentWorldX, y: currentWorldY };
    this.snapshot.canvasMousePos = { x: canvasX, y: canvasY };
  }

  private setEmptySnapshot(): void {
    this.snapshot.screenMousePos = EMPTY_POINTER_POSITION;
    this.snapshot.worldMousePos = EMPTY_POINTER_POSITION;
    this.snapshot.canvasMousePos = EMPTY_POINTER_POSITION;
  }
}
