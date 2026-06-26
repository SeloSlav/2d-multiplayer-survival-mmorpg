import { Cloud } from '../../generated/types'; // Import generated types
import { InterpolatedCloudData } from '../../engine/runtime/cloudInterpolationRuntime';

export type { Cloud };

interface RenderCloudsParams {
  ctx: CanvasRenderingContext2D;
  clouds: Map<string, InterpolatedCloudData>; // <<< Changed type
  cloudImages: Map<string, HTMLImageElement>; // Added to accept loaded cloud images
  worldScale: number;
  cameraOffsetX: number;
  cameraOffsetY: number;
}

// Pre-computed constants
const DEG_TO_RAD = Math.PI / 180;
const CLOUD_SIZE_MULTIPLIER = 1.5;

// Cache for cloud image name extraction (avoid regex in hot path)
const cloudImageNameCache = new Map<string, string>();

function getCloudImageName(shapeTag: string): string {
  let cached = cloudImageNameCache.get(shapeTag);
  if (cached) return cached;
  
  // Extract number from shape.tag (e.g., "CloudImage1" -> "cloud1.png")
  const match = shapeTag.match(/(\d+)$/);
  cached = match && match[1] ? `cloud${match[1]}.png` : 'cloud1.png';
  cloudImageNameCache.set(shapeTag, cached);
  return cached;
}

export function renderCloudsDirectly({ ctx, clouds, cloudImages, worldScale }: RenderCloudsParams): void {
  if (!clouds || clouds.size === 0) return;
  if (!cloudImages || cloudImages.size === 0) {
    // Cloud images not loaded yet - skip rendering silently
    return;
  }

  // Pre-compute scale factor
  const scaledMultiplier = worldScale * CLOUD_SIZE_MULTIPLIER;
  
  // Use forEach with arrow function - Map.forEach is well-optimized
  clouds.forEach(cloud => {
    const { currentRenderPosX, currentRenderPosY, width, height, rotationDegrees, currentOpacity, blurStrength, shape } = cloud;

    // Use cached image name lookup
    const imageName = getCloudImageName(shape.tag);
    const cloudImage = cloudImages.get(imageName);

    if (!cloudImage) return; // Skip if image not loaded/found

    // Pre-compute values
    const renderWidth = width * scaledMultiplier;
    const renderHeight = height * scaledMultiplier;
    const halfWidth = renderWidth * 0.5;
    const halfHeight = renderHeight * 0.5;

    ctx.save();
    ctx.translate(currentRenderPosX * worldScale, currentRenderPosY * worldScale); 
    ctx.rotate(rotationDegrees * DEG_TO_RAD);

    const darkerOpacity = Math.min(currentOpacity * 1.5, 0.15);
    ctx.globalAlpha = darkerOpacity;

    // Only set filter if blur is needed (filter changes are expensive)
    if (blurStrength > 0) {
      ctx.filter = `brightness(0%) blur(${blurStrength * worldScale}px)`;
    } else {
      ctx.filter = 'brightness(0%)';
    }
    
    ctx.drawImage(cloudImage, -halfWidth, -halfHeight, renderWidth, renderHeight);
    ctx.restore(); 
  });

  ctx.filter = 'none';
  ctx.globalAlpha = 1.0;
}
