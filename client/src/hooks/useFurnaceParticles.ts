import { useState, useEffect, useRef } from 'react';
import { Furnace } from '../generated';
import { FURNACE_HEIGHT, FURNACE_RENDER_Y_OFFSET } from '../utils/renderers/furnaceRenderingUtils';

export interface FurnaceParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  alpha: number;
  type: 'forge_fire' | 'industrial_smoke' | 'metal_spark';
}

export function useFurnaceParticles({ visibleFurnacesMap }: { visibleFurnacesMap: Map<string, Furnace> }) {
  const [particles, setParticles] = useState<FurnaceParticle[]>([]);
  const animationRef = useRef<number>(0);
  const lastTimeRef = useRef<number>(Date.now());

  useEffect(() => {
    const updateParticles = () => {
      const now = Date.now();
      const deltaTime = now - lastTimeRef.current;
      lastTimeRef.current = now;

      setParticles(prevParticles => {
        // Update existing particles
        let updatedParticles = prevParticles.map(particle => ({
          ...particle,
          x: particle.x + particle.vx * (deltaTime / 16.67),
          y: particle.y + particle.vy * (deltaTime / 16.67),
          life: particle.life - deltaTime,
          alpha: Math.max(0, (particle.life - deltaTime) / particle.maxLife),
          // Apply particle physics
          vy: particle.type === 'metal_spark' ? particle.vy + 0.08 : particle.vy - 0.02, // Gravity for sparks, upward for fire/smoke
        })).filter(particle => particle.life > 0);

        // Add new particles for burning furnaces
        visibleFurnacesMap.forEach(furnace => {
          if (furnace.isBurning && !furnace.isDestroyed) {
            const centerX = furnace.posX - 8;
            const centerY = furnace.posY - (FURNACE_HEIGHT / 2) - FURNACE_RENDER_Y_OFFSET - 12;
            
            // MAIN FURNACE PARTICLES (sparks + tiny fire)
            // Add tiny fire particles back
            if (Math.random() < 0.08) { // Small chance for tiny fire
              updatedParticles.push({
                x: centerX + (Math.random() - 0.5) * 6, // Small spread
                y: centerY + FURNACE_HEIGHT * 0.28,
                vx: (Math.random() - 0.5) * 0.3, // Very slow
                vy: -Math.random() * 0.8 - 0.3, // Gentle upward
                life: 600 + Math.random() * 400,
                maxLife: 600 + Math.random() * 400,
                size: 2 + Math.random() * 2, // Small fire particles
                color: ['#cc4400', '#aa3300', '#dd5500'][Math.floor(Math.random() * 3)],
                alpha: 0.8,
                type: 'forge_fire'
              });
            }

            // Add metal spark particles (dramatically reduced and slower)
            if (Math.random() < 0.05) { // Reduced from 0.2 to 0.05
              updatedParticles.push({
                x: centerX + (Math.random() - 0.5) * 8, // Reduced spread
                y: centerY + FURNACE_HEIGHT * 0.25,
                vx: (Math.random() - 0.5) * 1.5, // Reduced from 3.0 to 1.5 - slower
                vy: -Math.random() * 1.0 - 0.2, // Reduced from -2.0 - 0.3 to -1.0 - 0.2 - slower
                life: 300 + Math.random() * 400,
                maxLife: 300 + Math.random() * 400,
                size: 1 + Math.random() * 3,
                color: ['#ffaa00', '#ff8800', '#ffcc22', '#ff9900'][Math.floor(Math.random() * 4)],
                alpha: 1,
                type: 'metal_spark'
              });
            }

            // SEPARATE LAZY SMOKE CHIMNEY (left and up from main)
            const smokeChimneyCenterX = centerX + 8; // Moved left from +20 to +8
            const smokeChimneyCenterY = centerY - 25; // Moved up from -15 to -25

            // Add natural furnace chimney smoke (smaller, more numerous, slower)
            if (Math.random() < 0.25) { // More frequent from 0.12 to 0.25
              updatedParticles.push({
                x: smokeChimneyCenterX + (Math.random() - 0.5) * 6, // Tighter spread
                y: smokeChimneyCenterY,
                vx: (Math.random() - 0.5) * 0.05, // Much slower horizontal drift
                vy: -Math.random() * 0.1 - 0.02, // Much slower lazy upward drift
                life: 2500 + Math.random() * 2000, // Even longer lasting smoke
                maxLife: 2500 + Math.random() * 2000,
                size: 2 + Math.random() * 4, // Much smaller from 6-14 to 2-6
                color: ['#888888', '#999999', '#777777', '#aaaaaa'][Math.floor(Math.random() * 4)], // Lighter natural smoke
                alpha: 0.3, // More transparent for natural effect
                type: 'industrial_smoke'
              });
            }
          }
        });

        return updatedParticles;
      });

      animationRef.current = requestAnimationFrame(updateParticles);
    };

    animationRef.current = requestAnimationFrame(updateParticles);
    
    return () => {
      if (animationRef.current) {
        cancelAnimationFrame(animationRef.current);
      }
    };
  }, [visibleFurnacesMap]);

  return particles;
} 