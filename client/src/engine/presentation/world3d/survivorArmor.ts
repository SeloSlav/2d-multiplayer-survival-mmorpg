import { Group } from 'three/webgpu';
import { ModelKit } from './modelKit';

export const ARMOR_SLOTS = ['head', 'chest', 'legs', 'hands', 'feet', 'back'] as const;
export type ArmorSlot = typeof ARMOR_SLOTS[number];
export type WornArmor = Partial<Record<ArmorSlot, string>>;

/** The current wearable definitions, also used by the animation preview. */
export const ARMOR_CATALOG: Record<ArmorSlot, readonly string[]> = {
  head: ['Cloth Hood', 'Bone Helmet', 'Wooden Helmet', 'Leather Helmet', 'Scale Helmet', 'Fox Fur Hood', 'Wolf Fur Hood', 'Headlamp', "Reed Diver's Helm"],
  chest: ['Cloth Shirt', 'Bone Chestplate', 'Wooden Chestplate', 'Leather Chestplate', 'Scale Chestplate', 'Fox Fur Coat', 'Wolf Fur Coat'],
  legs: ['Cloth Pants', 'Bone Leggings', 'Wooden Leggings', 'Leather Leggings', 'Scale Leggings', 'Fox Fur Leggings', 'Wolf Fur Leggings'],
  hands: ['Cloth Gloves', 'Bone Gauntlets', 'Wooden Gauntlets', 'Leather Gauntlets', 'Scale Gauntlets', 'Fox Fur Gloves', 'Wolf Fur Gloves'],
  feet: ['Cloth Boots', 'Bone Boots', 'Wooden Boots', 'Leather Boots', 'Scale Boots', 'Fox Fur Boots', 'Wolf Fur Boots', 'Reed Flippers', 'Shark Fin Flippers', "Babushka's Boots of Speed"],
  back: ['Cloth Cape', 'Leather Cape', 'Kayux Amulet', 'Sabaakax Totem', "Qax'aadax Totem", 'Tugix Totem', 'Tunux Charm', 'Qilax Totem', 'Tanuux Totem', 'Ulax Charm', 'Angunax Totem', 'Alax Totem', 'Tayngax Totem', 'Qaangax Totem'],
};

type Equipment = Partial<Record<`${ArmorSlot}ItemInstanceId`, bigint | number | null>>;
type Inventory = { itemDefId?: bigint | number };
type Definition = { name?: string };

/** Instance IDs, not definition IDs, are stored in the equipment row. */
export function resolveWornArmor(equipment: Equipment | null | undefined,
  inventory: Map<string, Inventory> | undefined, definitions: Map<string, Definition> | undefined): WornArmor {
  const result: WornArmor = {};
  for (const slot of ARMOR_SLOTS) {
    const id = equipment?.[`${slot}ItemInstanceId`];
    if (id == null) continue;
    const item = inventory?.get(String(id));
    const name = item?.itemDefId == null ? undefined : definitions?.get(String(item.itemDefId))?.name;
    if (name) result[slot] = name;
  }
  return result;
}

type Palette = { main: number; trim: number; accent: number; style: 'cloth' | 'leather' | 'bone' | 'wood' | 'scale' | 'fur' | 'special' };
function palette(name: string): Palette {
  if (name.startsWith('Fox Fur')) return { main: 0xa9572e, trim: 0xe1bf8b, accent: 0x633a29, style: 'fur' };
  if (name.startsWith('Wolf Fur')) return { main: 0x68665d, trim: 0xc4c0ad, accent: 0x3e403e, style: 'fur' };
  if (name.startsWith('Bone')) return { main: 0xd8c9a0, trim: 0x786047, accent: 0xf1e2bc, style: 'bone' };
  if (name.startsWith('Wooden')) return { main: 0x815b35, trim: 0x4d3828, accent: 0xba9360, style: 'wood' };
  if (name.startsWith('Scale')) return { main: 0x536751, trim: 0x344438, accent: 0x9aac77, style: 'scale' };
  if (name.startsWith('Leather') || name.startsWith("Babushka's")) return { main: 0x80563b, trim: 0x48392e, accent: 0xc29667, style: 'leather' };
  if (name.startsWith('Cloth')) return { main: 0xa69a7e, trim: 0x665d51, accent: 0xd5c9a9, style: 'cloth' };
  return { main: 0x8d7954, trim: 0x473f32, accent: 0xd2c196, style: 'special' };
}

/** Armor lives under anatomical joints, so equipment follows every existing pose. */
export class SurvivorArmor {
  private readonly anchors: Record<ArmorSlot, Group[]>;
  private readonly current: WornArmor = {};
  private readonly cache = new Map<string, Group[]>();
  constructor(private readonly kit: ModelKit, parts: { head: Group; torso: Group; arms: Group[]; hands: Group[]; legs: Group[]; knees: Group[] }, private readonly skirt: Group) {
    this.anchors = { head: [parts.head], chest: [parts.torso, ...parts.arms], legs: [...parts.legs, ...parts.knees], hands: parts.hands, feet: parts.knees, back: [parts.torso] };
  }

  update(worn: WornArmor = {}): void {
    for (const slot of ARMOR_SLOTS) {
      const name = worn[slot] ?? '';
      if ((this.current[slot] ?? '') === name) continue;
      const previous = this.cache.get(`${slot}:${this.current[slot] ?? ''}`);
      previous?.forEach(group => group.removeFromParent());
      this.current[slot] = name;
      if (!name) continue;
      const key = `${slot}:${name}`;
      let pieces = this.cache.get(key);
      if (!pieces) { pieces = this.create(slot, name); this.cache.set(key, pieces); }
      pieces.forEach((group, index) => this.anchors[slot][index].add(group));
    }
    this.skirt.visible = !worn.legs;
  }

  private create(slot: ArmorSlot, name: string): Group[] {
    const p = palette(name), groups = this.anchors[slot].map(() => new Group());
    groups.forEach((group, index) => { group.name = `armor-${slot}-${index}`; group.userData.armorName = name; });
    const part = this.kit.part.bind(this.kit);
    const plate = (g: Group, size: [number, number, number], pos: [number, number, number]) => {
      part(g, p.style === 'fur' ? 'rock' : 'box', p.main, size, pos);
    };
    if (slot === 'head') {
      const g = groups[0];
      if (name === 'Headlamp') {
        part(g, 'box', p.trim, [.5,.07,.48], [0,.22,0]);
        part(g, 'cylinder', 0xbca468, [.18,.11,.18], [0,.24,.26]).rotation.x = Math.PI / 2;
        part(g, 'rock', 0xe6b961, [.11,.11,.06], [0,.24,.33]);
      } else if (name === "Reed Diver's Helm") {
        part(g, 'rock', p.main, [.57,.56,.53], [0,.14,-.04]);
        part(g, 'box', 0x557b77, [.32,.15,.07], [0,.14,.24]);
        part(g, 'cylinder', p.accent, [.07,.47,.07], [.21,.46,-.04]);
      } else {
        if (p.style === 'wood') plate(g, [.55,.22,.53], [0,.33,-.02]);
        else part(g, 'rock', p.main, [.68,.37,.65], [0,.31,-.02]);
        plate(g, [.52,.35,.21], [0,.10,-.19]);
        for (const sign of [-1, 1]) plate(g, [.09,.30,.36], [sign*.245,.12,-.03]);
        part(g, 'box', p.trim, [.55,.045,.08], [0,.265,.235]);
        if (p.style === 'fur') for (const sign of [-1,1]) part(g, 'rock', p.trim, [.13,.35,.16], [sign*.22,.11,.18]);
        if (p.style === 'bone') part(g, 'box', p.accent, [.075,.07,.39], [0,.47,-.02]);
      }
    } else if (slot === 'chest') {
      const g = groups[0];
      plate(g, [.69,.58,.45], [0,1.04,0]);
      part(g, 'box', p.trim, [.60,.07,.48], [0,.84,0]);
      if (p.style === 'bone' || p.style === 'wood' || p.style === 'scale') {
        for (let i=0;i<3;i++) part(g, 'box', i===1?p.accent:p.main, [.53,.11,.045], [0,.92+i*.13,.245]);
      } else part(g, 'box', p.accent, [.07,.47,.045], [0,1.04,.24]);
      for (let i=1;i<groups.length;i++) {
        plate(groups[i], [.27,.29,.28], [0,-.13,0]);
        if (p.style === 'fur') part(groups[i], 'rock', p.trim, [.29,.08,.29], [0,-.24,0]);
      }
    } else if (slot === 'legs') {
      for (let i=0;i<groups.length;i++) {
        plate(groups[i], i<2?[.24,.37,.25]:[.24,.25,.25], [0,i<2?-.18:-.11,0]);
        part(groups[i], 'box', p.trim, [.25,.045,.26], [0,i<2?-.29:-.17,.01]);
      }
    } else if (slot === 'hands') {
      for (const g of groups) {
        plate(g, [.16,.18,.16], [0,0,-.015]);
        part(g, 'box', p.trim, [.15,.04,.17], [0,.055,0]);
      }
    } else if (slot === 'feet') {
      for (const g of groups) {
        const flipper = name.includes('Flippers');
        plate(g, [.26,.20,flipper ? .62 : .39], [0,-.25,flipper ? .17 : .06]);
        part(g, 'box', p.trim, [.26,.05,flipper ? .62 : .39], [0,-.34,flipper ? .17 : .06]);
      }
    } else {
      const g=groups[0];
      if (name.includes('Totem') || name.includes('Amulet') || name.includes('Charm')) {
        part(g, 'box', p.trim, [.10,.48,.05], [0,1.08,-.24]);
        part(g, 'rock', 0xe0d5b6, [.27,.27,.14], [0,.98,-.30]);
        for (const x of [-.06,.06]) part(g, 'box', 0x413a31, [.045,.045,.025], [x,1.02,-.38]);
      } else {
        plate(g, [.56,.63,.09], [0,.99,-.27]);
        part(g, 'box', p.trim, [.57,.08,.11], [0,1.25,-.27]);
      }
    }
    return groups.map((group, index) => {
      const compiled = this.kit.compileShared(group, `armor:${slot}:${name}:${index}`);
      compiled.name = group.name; compiled.userData.armorName = name;
      return compiled;
    });
  }
}
