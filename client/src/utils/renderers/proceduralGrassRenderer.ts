// Procedural Grass Renderer - No Database Subscriptions Required
// Generates grass based on world coordinates using deterministic algorithms

export interface ProceduralGrassConfig {
    density: number; // Grass per 48x48 tile
    seed: number; // World seed for consistency
    tileSize: number; // Size of each grass tile
    grassVariety: number; // Number of different grass appearances
}

export interface GrassInstance {
    x: number;
    y: number;
    type: number; // 0-grassVariety
    scale: number; // 0.8-1.2
    rotation: number; // 0-360 degrees
    swayOffset: number; // For animation
}

// Simple deterministic random number generator
class SeededRandom {
    private seed: number;

    constructor(seed: number) {
        this.seed = seed;
    }

    next(): number {
        this.seed = (this.seed * 9301 + 49297) % 233280;
        return this.seed / 233280;
    }
}

export class ProceduralGrassRenderer {
    private config: ProceduralGrassConfig;
    private grassCache: Map<string, GrassInstance[]> = new Map();

    constructor(config: ProceduralGrassConfig) {
        this.config = config;
    }

    // Generate grass for a specific world tile (48x48 pixels)
    public getGrassForTile(tileX: number, tileY: number): GrassInstance[] {
        const tileKey = `${tileX},${tileY}`;
        
        // Check cache first
        if (this.grassCache.has(tileKey)) {
            return this.grassCache.get(tileKey)!;
        }

        const grass: GrassInstance[] = [];
        
        // Create deterministic random generator for this tile
        const rng = new SeededRandom(this.config.seed + tileX * 1000 + tileY);
        
        const baseX = tileX * this.config.tileSize;
        const baseY = tileY * this.config.tileSize;
        
        // Generate grass instances for this tile
        for (let i = 0; i < this.config.density; i++) {
            grass.push({
                x: baseX + rng.next() * this.config.tileSize,
                y: baseY + rng.next() * this.config.tileSize,
                type: Math.floor(rng.next() * this.config.grassVariety),
                scale: 0.8 + rng.next() * 0.4, // 0.8 to 1.2
                rotation: rng.next() * 360,
                swayOffset: rng.next() * Math.PI * 2
            });
        }
        
        // Cache for future use
        this.grassCache.set(tileKey, grass);
        return grass;
    }

    // Get all grass instances visible in a viewport
    public getVisibleGrass(
        cameraX: number, 
        cameraY: number, 
        viewportWidth: number, 
        viewportHeight: number
    ): GrassInstance[] {
        const allGrass: GrassInstance[] = [];
        
        // Calculate which tiles are visible (with padding)
        const padding = this.config.tileSize;
        const startTileX = Math.floor((cameraX - padding) / this.config.tileSize);
        const endTileX = Math.ceil((cameraX + viewportWidth + padding) / this.config.tileSize);
        const startTileY = Math.floor((cameraY - padding) / this.config.tileSize);
        const endTileY = Math.ceil((cameraY + viewportHeight + padding) / this.config.tileSize);
        
        // Generate grass for all visible tiles
        for (let tileX = startTileX; tileX <= endTileX; tileX++) {
            for (let tileY = startTileY; tileY <= endTileY; tileY++) {
                const tileGrass = this.getGrassForTile(tileX, tileY);
                
                // Filter to only grass actually in viewport
                for (const grass of tileGrass) {
                    if (grass.x >= cameraX - padding && 
                        grass.x <= cameraX + viewportWidth + padding &&
                        grass.y >= cameraY - padding && 
                        grass.y <= cameraY + viewportHeight + padding) {
                        allGrass.push(grass);
                    }
                }
            }
        }
        
        return allGrass;
    }

    // Render grass instances to canvas
    public render(
        ctx: CanvasRenderingContext2D,
        grassInstances: GrassInstance[],
        cameraX: number,
        cameraY: number,
        animationTime: number = 0
    ) {
        for (const grass of grassInstances) {
            const screenX = grass.x - cameraX;
            const screenY = grass.y - cameraY;
            
            ctx.save();
            ctx.translate(screenX, screenY);
            ctx.rotate((grass.rotation * Math.PI) / 180);
            ctx.scale(grass.scale, grass.scale);
            
            // Simple sway animation
            const swayAmount = Math.sin(animationTime * 0.001 + grass.swayOffset) * 2;
            ctx.translate(swayAmount, 0);
            
            // Render grass sprite (simple colored rectangle for now)
            const grassColors = ['#2d5a27', '#3d6b37', '#4d7b47', '#1d4a17'];
            ctx.fillStyle = grassColors[grass.type] || grassColors[0];
            ctx.fillRect(-2, -6, 4, 12);
            
            ctx.restore();
        }
    }

    // Clear cache to free memory (call periodically)
    public clearCache() {
        this.grassCache.clear();
    }
}

// Default configuration
export const DEFAULT_GRASS_CONFIG: ProceduralGrassConfig = {
    density: 8, // 8 grass per 48x48 tile
    seed: 12345,
    tileSize: 48,
    grassVariety: 4
}; 