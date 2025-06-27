// Utility functions for calculating effective arrow damage
// Based on server/src/projectile.rs calculate_projectile_damage function

import { ItemDefinition } from '../generated';

interface DamageRange {
  min: number;
  max: number;
}

// Common ranged weapons and their damage values (from server/src/items_database.rs)
const RANGED_WEAPON_DAMAGES: { [weaponName: string]: DamageRange } = {
  'Hunting Bow': { min: 50, max: 50 },
  'Crossbow': { min: 75, max: 75 },
};

/**
 * Calculate effective damage range for ammunition when used with available ranged weapons
 * Based on the projectile damage calculation logic from server/src/projectile.rs
 */
export function calculateEffectiveArrowDamage(
  ammoDefinition: ItemDefinition,
  availableWeapons?: string[]
): { weaponName: string; damage: DamageRange }[] | null {
  // Only calculate for ammunition category
  if (ammoDefinition.category.tag !== 'Ammunition') {
    return null;
  }

  const results: { weaponName: string; damage: DamageRange }[] = [];
  
  // Use available weapons or default to all ranged weapons
  const weaponsToCheck = availableWeapons || Object.keys(RANGED_WEAPON_DAMAGES);
  
  for (const weaponName of weaponsToCheck) {
    const weaponDamage = RANGED_WEAPON_DAMAGES[weaponName];
    if (!weaponDamage) continue;

    const effectiveDamage = calculateProjectileDamage(weaponDamage, ammoDefinition);
    if (effectiveDamage) {
      results.push({
        weaponName,
        damage: effectiveDamage
      });
    }
  }

  return results.length > 0 ? results : null;
}

/**
 * Calculate damage for a specific weapon + ammunition combination
 * Implements the same logic as server/src/projectile.rs calculate_projectile_damage
 */
function calculateProjectileDamage(
  weaponDamage: DamageRange,
  ammoDefinition: ItemDefinition
): DamageRange | null {
  const ammoMin = ammoDefinition.pvpDamageMin ?? 0;
  const ammoMax = ammoDefinition.pvpDamageMax ?? ammoMin;

  // Apply damage calculation rules based on ammunition type
  switch (ammoDefinition.name) {
    case 'Fire Arrow':
      // Fire arrows use only ammunition damage, ignoring weapon damage
      return { min: ammoMin, max: ammoMax };
      
    case 'Hollow Reed Arrow':
      // Hollow Reed arrows subtract their damage from weapon damage (minimum 1)
      return {
        min: Math.max(1, weaponDamage.min - ammoMax), // Use max ammo damage for min result
        max: Math.max(1, weaponDamage.max - ammoMin)  // Use min ammo damage for max result
      };
      
    default:
      // Default case: weapon damage + ammunition damage (includes Wooden Arrow with 0 modifier)
      return {
        min: weaponDamage.min + ammoMin,
        max: weaponDamage.max + ammoMax
      };
  }
}

/**
 * Format damage range for display in tooltips
 */
export function formatDamageRange(damage: DamageRange): string {
  if (damage.min === damage.max) {
    return `${damage.min}`;
  }
  return `${damage.min}-${damage.max}`;
}

/**
 * Get a concise tooltip description for arrow damage
 */
export function getArrowDamageTooltip(ammoDefinition: ItemDefinition): string | null {
  const effectiveDamages = calculateEffectiveArrowDamage(ammoDefinition);
  if (!effectiveDamages || effectiveDamages.length === 0) {
    return null;
  }

  // For now, show damage with Hunting Bow (most common weapon)
  const bowDamage = effectiveDamages.find(result => result.weaponName === 'Hunting Bow');
  if (bowDamage) {
    const damageText = formatDamageRange(bowDamage.damage);
    
    // Add special descriptions for special arrow types
    switch (ammoDefinition.name) {
      case 'Fire Arrow':
        return `${damageText} (ignores weapon damage)`;
      case 'Hollow Reed Arrow':
        return `${damageText} (reduces total damage)`;
      case 'Wooden Arrow':
        return `${damageText} (neutral modifier)`;
      case 'Bone Arrow':
        return `${damageText} (bonus damage)`;
      default:
        return damageText;
    }
  }

  return null;
} 