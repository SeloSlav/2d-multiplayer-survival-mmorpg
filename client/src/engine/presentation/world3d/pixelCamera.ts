import { WORLD_3D } from './visualContract';

/** Lock raster sampling to world pixels, then carry the subpixel camera motion
 * in CSS. Overscan covers the residual translation without moving UI/input. */
export function pixelCameraPlan(width: number, height: number, centerX: number, centerY: number, zoom = 1) {
  const scale = WORLD_3D.pixelScale;
  const renderWidth = Math.ceil(Math.max(1, width) / scale) + 2;
  const renderHeight = Math.ceil(Math.max(1, height) / scale) + 2;
  const cssWidth = renderWidth * scale, cssHeight = renderHeight * scale;
  const step = scale / zoom;
  const x = Math.round(centerX / step) * step, y = Math.round(centerY / step) * step;
  return { renderWidth, renderHeight, cssWidth, cssHeight, centerX: x, centerY: y,
    translateX: (x - centerX) * zoom - (cssWidth - width) / 2,
    translateY: (y - centerY) * zoom - (cssHeight - height) / 2 };
}
