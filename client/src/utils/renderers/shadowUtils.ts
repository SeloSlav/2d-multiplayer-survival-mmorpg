/**
 * Draws a simple elliptical shadow on the canvas.
 * @param ctx The rendering context.
 * @param centerX The horizontal center of the shadow.
 * @param baseY The vertical position where the shadow sits on the ground.
 * @param radiusX The horizontal radius of the shadow ellipse.
 * @param radiusY The vertical radius of the shadow ellipse.
 */
export function drawShadow(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  baseY: number, 
  radiusX: number,
  radiusY: number
) {
  ctx.save();
  ctx.fillStyle = 'rgba(0, 0, 0, 0.35)'; // 35% opacity black
  ctx.beginPath();
  // Draw an ellipse centered horizontally at centerX, vertically at baseY
  ctx.ellipse(centerX, baseY, radiusX, radiusY, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
} 