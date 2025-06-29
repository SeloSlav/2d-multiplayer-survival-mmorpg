/**
 * Draws a simple circular progress indicator.
 * 
 * @param ctx The canvas rendering context.
 * @param x The center X coordinate.
 * @param y The center Y coordinate.
 * @param progress A value between 0 (empty) and 1 (full).
 * @param radius The radius of the circle.
 * @param bgColor Background color of the circle.
 * @param progressColor Color of the progress arc.
 */
export function drawInteractionIndicator(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    progress: number,
    radius: number = 15,
    bgColor: string = 'rgba(255, 255, 255, 0.3)',
    progressColor: string = 'rgba(255, 255, 255, 0.9)'
  ): void {
    const startAngle = -Math.PI / 2; // Start at the top
    const endAngle = startAngle + (progress * 2 * Math.PI);
  
    ctx.save();
  
    // Draw background circle
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, 2 * Math.PI);
    ctx.fillStyle = bgColor;
    ctx.fill();
  
    // Draw progress arc
    if (progress > 0) {
      ctx.beginPath();
      ctx.moveTo(x, y); // Start from center for a pie-like fill
      ctx.arc(x, y, radius, startAngle, endAngle);
      ctx.closePath(); // Close path back to center
      ctx.fillStyle = progressColor;
      ctx.fill();
    }
  
    ctx.restore();
  }

 