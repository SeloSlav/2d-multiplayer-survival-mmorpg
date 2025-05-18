import { Cloud } from '../../generated'; // Import generated types
import { InterpolatedCloudData } from '../../hooks/useCloudInterpolation'; // <<< Added import

export type { Cloud };

interface RenderCloudsParams {
  ctx: CanvasRenderingContext2D;
  clouds: Map<string, InterpolatedCloudData>; // <<< Changed type
  cloudImages: Map<string, HTMLImageElement>; // Added to accept loaded cloud images
  worldScale: number;
  cameraOffsetX: number;
  cameraOffsetY: number;
}

export function renderCloudsDirectly({ ctx, clouds, cloudImages, worldScale }: RenderCloudsParams): void {
  if (!clouds || clouds.size === 0) {
    // console.log("[renderCloudsDirectly] No clouds data to render."); // Keep logs minimal unless debugging
    return;
  }
  if (!cloudImages || cloudImages.size === 0) {
    console.warn("[renderCloudsDirectly] No cloudImages map or it is empty.");
    return;
  }
  
  const DEBUG_CLOUDS = false; // ENABLED FOR DIAGNOSIS

  if (DEBUG_CLOUDS) {
    console.log(`[renderCloudsDirectly] Attempting to render ${clouds.size} clouds. Images available in map: ${cloudImages.size}. Keys: ${Array.from(cloudImages.keys()).join(', ')}`);
  }

  const cloudSizeMultiplier = 1.5; // Added: Make clouds 50% larger

  clouds.forEach(cloud => {
    // Destructure from InterpolatedCloudData - uses currentRenderPosX/Y
    const { id, currentRenderPosX, currentRenderPosY, width, height, rotationDegrees, baseOpacity, blurStrength, shape } = cloud;

    if (DEBUG_CLOUDS) {
      console.log(`[renderCloudsDirectly] Processing Cloud ID: ${id}, Shape Tag from data: '${shape.tag}'`);
    }

    // Corrected imageName generation: Extract number from shape.tag and append .png
    // Assumes shape.tag is like "CloudImage1", "CloudImage2", etc.
    const match = shape.tag.match(/(\d+)$/);
    let imageName = 'cloud1.png'; // Default fallback, though should ideally always match
    if (match && match[1]) {
      imageName = `cloud${match[1]}.png`;
    }
    
    if (DEBUG_CLOUDS) {
      console.log(`[renderCloudsDirectly] Cloud ID: ${id}, Generated imageName to lookup: '${imageName}'`);
    }

    const cloudImage = cloudImages.get(imageName);

    if (!cloudImage) {
      if (DEBUG_CLOUDS) console.warn(`[renderCloudsDirectly] Cloud ID: ${id}, Image NOT FOUND for shape.tag: '${shape.tag}' (tried to get '${imageName}')`);
      return; // Skip if image not loaded/found
    }
    if (DEBUG_CLOUDS) {
      console.log(`[renderCloudsDirectly] Cloud ID: ${id}, Image FOUND for '${imageName}'. Dimensions: ${cloudImage.width}x${cloudImage.height}`);
    }

    // Use currentRenderPosX and currentRenderPosY for positioning
    const worldCloudCenterX = currentRenderPosX;
    const worldCloudCenterY = currentRenderPosY;
    const renderWidth = width * worldScale * cloudSizeMultiplier;
    const renderHeight = height * worldScale * cloudSizeMultiplier;

    if (DEBUG_CLOUDS) {
      console.log(
          `[renderCloudsDirectly] Cloud ID: ${id}, `, 
          `WorldPos=(${worldCloudCenterX.toFixed(1)}, ${worldCloudCenterY.toFixed(1)}), `, 
          `RenderSize=(${renderWidth.toFixed(1)}x${renderHeight.toFixed(1)}), Opacity: ${baseOpacity}, Blur: ${blurStrength}`
      );
    }

    ctx.save();
    // Translate to the cloud's world position (which is already interpolated)
    // The main canvas context is already translated by cameraOffset, so these world positions work directly.
    ctx.translate(worldCloudCenterX * worldScale, worldCloudCenterY * worldScale); 
    ctx.rotate(rotationDegrees * Math.PI / 180);

    const darkerOpacity = Math.min(baseOpacity * 1.5, 0.15);
    ctx.globalAlpha = darkerOpacity;

    let currentFilter = 'brightness(0%)';
    if (blurStrength > 0) {
      currentFilter += ` blur(${blurStrength * worldScale}px)`;
    }
    ctx.filter = currentFilter;
    
    ctx.drawImage(
      cloudImage,
      -renderWidth / 2, 
      -renderHeight / 2, 
      renderWidth,
      renderHeight
    );

    ctx.restore(); 
  });

  if (DEBUG_CLOUDS && clouds.size > 0) {
      console.log("[renderCloudsDirectly] Finished cloud rendering loop.");
  }

  ctx.filter = 'none';
  ctx.globalAlpha = 1.0;
}
