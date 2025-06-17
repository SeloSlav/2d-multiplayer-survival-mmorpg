/**
 * Utility functions for drawing interaction outlines around objects
 */

/**
 * Draws a glowing outline around an object to indicate it can be interacted with
 */
export function drawInteractionOutline(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    cycleProgress: number,
    outlineColor: string = '#00FF00', // Bright green by default
    baseAlpha: number = 0.6
): void {
    // Create pulsing effect based on cycle progress
    const pulseIntensity = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(cycleProgress * Math.PI * 4));
    const alpha = baseAlpha * pulseIntensity;
    
    // Draw multiple outline layers for glow effect
    ctx.save();
    
    // Outer glow (wider, more transparent)
    ctx.strokeStyle = `rgba(${hexToRgb(outlineColor)}, ${alpha * 0.3})`;
    ctx.lineWidth = 6;
    ctx.setLineDash([]);
    ctx.strokeRect(x - width/2 - 3, y - height/2 - 3, width + 6, height + 6);
    
    // Middle glow
    ctx.strokeStyle = `rgba(${hexToRgb(outlineColor)}, ${alpha * 0.6})`;
    ctx.lineWidth = 4;
    ctx.strokeRect(x - width/2 - 1, y - height/2 - 1, width + 2, height + 2);
    
    // Inner outline (brightest)
    ctx.strokeStyle = `rgba(${hexToRgb(outlineColor)}, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.strokeRect(x - width/2, y - height/2, width, height);
    
    ctx.restore();
}

/**
 * Draws a circular interaction outline for round objects
 */
export function drawCircularInteractionOutline(
    ctx: CanvasRenderingContext2D,
    centerX: number,
    centerY: number,
    radius: number,
    cycleProgress: number,
    outlineColor: string = '#00FF00',
    baseAlpha: number = 0.6
): void {
    // Create pulsing effect
    const pulseIntensity = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(cycleProgress * Math.PI * 4));
    const alpha = baseAlpha * pulseIntensity;
    
    ctx.save();
    
    // Outer glow
    ctx.strokeStyle = `rgba(${hexToRgb(outlineColor)}, ${alpha * 0.3})`;
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 3, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Middle glow
    ctx.strokeStyle = `rgba(${hexToRgb(outlineColor)}, ${alpha * 0.6})`;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 1, 0, 2 * Math.PI);
    ctx.stroke();
    
    // Inner outline
    ctx.strokeStyle = `rgba(${hexToRgb(outlineColor)}, ${alpha})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, 2 * Math.PI);
    ctx.stroke();
    
    ctx.restore();
}

/**
 * Converts hex color to RGB values for rgba() string
 */
function hexToRgb(hex: string): string {
    // Remove # if present
    hex = hex.replace('#', '');
    
    // Convert hex to RGB
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    
    return `${r}, ${g}, ${b}`;
}

/**
 * Gets the appropriate outline color based on interaction type
 */
export function getInteractionOutlineColor(interactionType: 'pickup' | 'open' | 'interact' | 'revive' | 'water'): string {
    switch (interactionType) {
        case 'pickup':
            return '#FFD700'; // Gold for pickups
        case 'open':
            return '#00BFFF'; // Light blue for containers
        case 'interact':
            return '#00FF00'; // Green for general interactions
        case 'revive':
            return '#FF6B6B'; // Red for reviving players
        case 'water':
            return '#00CED1'; // Dark turquoise for water
        default:
            return '#00FF00'; // Default green
    }
} 