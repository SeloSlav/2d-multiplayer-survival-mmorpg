/** Must match the server's melee-throw eligibility and reserved right clicks. */
export function isThrowableMelee(item: { name?: string; category?: { tag: string }; pvpDamageMax?: number | null } | null | undefined): boolean {
  return item?.category?.tag === 'Weapon' || (item?.category?.tag === 'Tool' && (item.pvpDamageMax ?? 0) > 0
    && !['Torch', 'Repair Hammer', 'Flashlight'].includes(item.name ?? ''));
}
