/**
 * Shared visual preset values for SettingsContext defaults and the Visual Cortex menu.
 * Advanced Graphics is the first-run default; Performance is the lighter preset from the menu.
 */

/** `localStorage` key — bump `VISUAL_SETTINGS_SCHEMA_VERSION` when shipping a new one-time visual migration. */
export const VISUAL_SETTINGS_SCHEMA_STORAGE_KEY = 'visualSettingsSchemaVersion';

/**
 * Schema history:
 * - 1 = one-time apply PERFORMANCE_VISUAL_DEFAULTS to all persisted visual keys.
 * - 2 = one-time apply ADVANCED_VISUAL_DEFAULTS (new product default).
 * - 3 = restore precipitation and grass motion disabled by the old performance preset.
 * Increment for future migrations; extend `migrateVisualSettingsSchemaIfNeeded` when behavior differs.
 */
export const VISUAL_SETTINGS_SCHEMA_VERSION = 3;

export const PERFORMANCE_VISUAL_DEFAULTS = {
    allShadowsEnabled: false,
    treeShadowsEnabled: false,
    weatherOverlayEnabled: true,
    stormAtmosphereEnabled: false,
    statusOverlaysEnabled: false,
    grassEnabled: true,
    grassAnimationEnabled: true,
    alwaysShowPlayerNames: true,
    cloudsEnabled: false,
    waterSurfaceEffectsEnabled: false,
    waterSurfaceEffectsIntensity: 0,
    worldParticlesQuality: 0,
    footprintsEnabled: false,
    bloomIntensity: 0,
    vignetteIntensity: 0,
    chromaticAberrationIntensity: 0,
    colorCorrection: 50,
} as const;

/** Full-fidelity configuration — default for new sessions and schema v2 migration. */
export const ADVANCED_VISUAL_DEFAULTS = {
    allShadowsEnabled: true,
    treeShadowsEnabled: true,
    weatherOverlayEnabled: true,
    stormAtmosphereEnabled: true,
    statusOverlaysEnabled: true,
    grassEnabled: true,
    grassAnimationEnabled: true,
    alwaysShowPlayerNames: true,
    cloudsEnabled: true,
    waterSurfaceEffectsEnabled: true,
    waterSurfaceEffectsIntensity: 75,
    worldParticlesQuality: 2,
    footprintsEnabled: true,
    bloomIntensity: 0,
    vignetteIntensity: 0,
    chromaticAberrationIntensity: 0,
    colorCorrection: 50,
} as const;

export type VisualSettingsPresetValues =
    | typeof PERFORMANCE_VISUAL_DEFAULTS
    | typeof ADVANCED_VISUAL_DEFAULTS;

/** Writes a visual preset to `localStorage` (same keys as SettingsContext). Does not touch audio or fixed simulation. */
export function writeVisualPresetToLocalStorage(p: VisualSettingsPresetValues): void {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem('allShadowsEnabled', String(p.allShadowsEnabled));
    localStorage.setItem('treeShadowsEnabled', String(p.treeShadowsEnabled));
    localStorage.setItem('weatherOverlayEnabled', String(p.weatherOverlayEnabled));
    localStorage.setItem('stormAtmosphereEnabled', String(p.stormAtmosphereEnabled));
    localStorage.setItem('statusOverlaysEnabled', String(p.statusOverlaysEnabled));
    localStorage.setItem('grassEnabled', String(p.grassEnabled));
    localStorage.setItem('grassAnimationEnabled', String(p.grassAnimationEnabled));
    localStorage.setItem('alwaysShowPlayerNames', String(p.alwaysShowPlayerNames));
    localStorage.setItem('cloudsEnabled', String(p.cloudsEnabled));
    localStorage.setItem('waterSurfaceEffectsEnabled', String(p.waterSurfaceEffectsEnabled));
    localStorage.setItem('waterSurfaceEffectsIntensity', String(p.waterSurfaceEffectsIntensity));
    localStorage.setItem('worldParticlesQuality', String(p.worldParticlesQuality));
    localStorage.setItem('footprintsEnabled', String(p.footprintsEnabled));
    localStorage.setItem('bloomIntensity', String(p.bloomIntensity));
    localStorage.setItem('vignetteIntensity', String(p.vignetteIntensity));
    localStorage.setItem('chromaticAberrationIntensity', String(p.chromaticAberrationIntensity));
    localStorage.setItem('colorCorrection', String(p.colorCorrection));
}

export function migrateVisualSettingsSchemaIfNeeded(): void {
    if (typeof localStorage === 'undefined') return;
    const raw = localStorage.getItem(VISUAL_SETTINGS_SCHEMA_STORAGE_KEY);
    const parsed = raw ? parseInt(raw, 10) : 0;
    if (!Number.isNaN(parsed) && parsed >= VISUAL_SETTINGS_SCHEMA_VERSION) {
        return;
    }
    if (!Number.isNaN(parsed) && parsed >= 2) {
        // Restore the two weather effects without changing the rest of a saved
        // graphics preset. Both remain individually configurable afterwards.
        localStorage.setItem('weatherOverlayEnabled','true');
        localStorage.setItem('grassAnimationEnabled','true');
    } else {
        writeVisualPresetToLocalStorage(ADVANCED_VISUAL_DEFAULTS);
    }
    localStorage.setItem(VISUAL_SETTINGS_SCHEMA_STORAGE_KEY, String(VISUAL_SETTINGS_SCHEMA_VERSION));
}
