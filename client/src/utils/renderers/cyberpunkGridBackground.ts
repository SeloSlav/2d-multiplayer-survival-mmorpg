/**
 * 🎯 CYBERPUNK: SOVA Grid Background Renderer
 * Renders the same cyberpunk grid pattern as the loading screen to show the edge of the simulation
 */

export interface CyberpunkGridConfig {
  // Grid colors (matching CyberpunkLoadingScreen.css)
  primaryGridColor: string;
  secondaryGridColor: string;
  
  // Grid sizes
  primaryGridSize: number;
  secondaryGridSize: number;
  
  // Animation
  pulseIntensity: number;
  pulseSpeed: number;
  
  // Glow effects
  glowColor1: string;
  glowColor2: string;
  baseOpacity: number;
}

const DEFAULT_GRID_CONFIG: CyberpunkGridConfig = {
  // Colors matching the loading screen CSS
  primaryGridColor: 'rgba(0, 221, 255, 0.3)',      // Same as CSS
  secondaryGridColor: 'rgba(0, 150, 255, 0.15)',   // Same as CSS
  
  // Grid sizes matching the loading screen
  primaryGridSize: 50,   // 50px grid like CSS
  secondaryGridSize: 10, // 10px grid like CSS
  
  // Animation settings
  pulseIntensity: 0.5,
  pulseSpeed: 8000, // 8 seconds like CSS
  
  // Glow colors
  glowColor1: 'rgba(0, 221, 255, 0.1)',
  glowColor2: 'rgba(0, 150, 255, 0.1)',
  baseOpacity: 0.7, // Same as CSS
};

let animationStartTime = Date.now();

/**
 * 🎯 CYBERPUNK: Renders the SOVA simulation grid background
 * This creates the illusion that the game world exists within a cyberpunk simulation
 */
export function renderCyberpunkGridBackground(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  cameraOffsetX: number = 0,
  cameraOffsetY: number = 0,
  config: Partial<CyberpunkGridConfig> = {}
): void {
  const gridConfig = { ...DEFAULT_GRID_CONFIG, ...config };
  
  ctx.save();
  
  // Fill base dark background
  ctx.fillStyle = '#1a0d2e'; // Dark purple-blue base like loading screen
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  
  // Calculate animation phase for pulsing effect
  const currentTime = Date.now();
  const elapsed = (currentTime - animationStartTime) % gridConfig.pulseSpeed;
  const pulsePhase = elapsed / gridConfig.pulseSpeed;
  const pulseMultiplier = 0.3 + (Math.sin(pulsePhase * Math.PI * 2) * 0.5 + 0.5) * gridConfig.pulseIntensity;
  
  // Calculate world position for grid alignment
  const worldStartX = -cameraOffsetX;
  const worldStartY = -cameraOffsetY;
  
  // Render primary grid (50px)
  renderGridLines(
    ctx,
    canvasWidth,
    canvasHeight,
    gridConfig.primaryGridSize,
    gridConfig.primaryGridColor,
    pulseMultiplier * gridConfig.baseOpacity,
    worldStartX,
    worldStartY
  );
  
  // Render secondary grid (10px) 
  renderGridLines(
    ctx,
    canvasWidth,
    canvasHeight,
    gridConfig.secondaryGridSize,
    gridConfig.secondaryGridColor,
    pulseMultiplier * gridConfig.baseOpacity * 0.6, // Dimmer secondary grid
    worldStartX,
    worldStartY
  );
  
  // Add holographic glow effects (matching CSS radial gradients)
  renderHolographicGlow(
    ctx,
    canvasWidth,
    canvasHeight,
    gridConfig.glowColor1,
    gridConfig.glowColor2,
    pulseMultiplier
  );
  
  ctx.restore();
}

/**
 * 🎯 CYBERPUNK: Renders grid lines with world-space alignment
 */
function renderGridLines(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  gridSize: number,
  color: string,
  opacity: number,
  worldStartX: number,
  worldStartY: number
): void {
  ctx.save();
  
  // Parse the rgba color and apply our opacity
  const colorMatch = color.match(/rgba?\(([^)]+)\)/);
  if (!colorMatch) return;
  
  const [r, g, b] = colorMatch[1].split(',').map(n => parseInt(n.trim()));
  ctx.strokeStyle = `rgba(${r}, ${g}, ${b}, ${opacity})`;
  ctx.lineWidth = 1;
  
  // Calculate grid start positions aligned to world coordinates
  const startX = (-worldStartX % gridSize) - gridSize;
  const startY = (-worldStartY % gridSize) - gridSize;
  
  ctx.beginPath();
  
  // Vertical lines
  for (let x = startX; x <= canvasWidth + gridSize; x += gridSize) {
    ctx.moveTo(Math.floor(x), 0);
    ctx.lineTo(Math.floor(x), canvasHeight);
  }
  
  // Horizontal lines
  for (let y = startY; y <= canvasHeight + gridSize; y += gridSize) {
    ctx.moveTo(0, Math.floor(y));
    ctx.lineTo(canvasWidth, Math.floor(y));
  }
  
  ctx.stroke();
  ctx.restore();
}

/**
 * 🎯 CYBERPUNK: Renders holographic glow effects (matching CSS radial gradients)
 */
function renderHolographicGlow(
  ctx: CanvasRenderingContext2D,
  canvasWidth: number,
  canvasHeight: number,
  glowColor1: string,
  glowColor2: string,
  pulseMultiplier: number
): void {
  ctx.save();
  
  // Create radial gradients matching the CSS
  const gradient1 = ctx.createRadialGradient(
    canvasWidth * 0.25, canvasHeight * 0.25, 0,
    canvasWidth * 0.25, canvasHeight * 0.25, Math.min(canvasWidth, canvasHeight) * 0.5
  );
  gradient1.addColorStop(0, glowColor1.replace(/[\d.]+\)$/, `${pulseMultiplier * 0.1})`));
  gradient1.addColorStop(1, 'transparent');
  
  const gradient2 = ctx.createRadialGradient(
    canvasWidth * 0.75, canvasHeight * 0.75, 0,
    canvasWidth * 0.75, canvasHeight * 0.75, Math.min(canvasWidth, canvasHeight) * 0.5
  );
  gradient2.addColorStop(0, glowColor2.replace(/[\d.]+\)$/, `${pulseMultiplier * 0.1})`));
  gradient2.addColorStop(1, 'transparent');
  
  // Apply the gradients
  ctx.fillStyle = gradient1;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  
  ctx.fillStyle = gradient2;
  ctx.fillRect(0, 0, canvasWidth, canvasHeight);
  
  ctx.restore();
}

/**
 * 🎯 CYBERPUNK: Reset animation timer (call when connecting to ensure fresh animation)
 */
export function resetGridAnimation(): void {
  animationStartTime = Date.now();
} 