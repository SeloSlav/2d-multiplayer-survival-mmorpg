import React, { useMemo } from 'react';
import styles from './MenuComponents.module.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTree, faCloudRain, faHeartPulse, faLeaf, faUsers, faGears } from '@fortawesome/free-solid-svg-icons';
import { useSettings } from '../contexts/SettingsContext';
import type { FixedSimulationMode } from '../contexts/SettingsContext';
import { ADVANCED_VISUAL_DEFAULTS, PERFORMANCE_VISUAL_DEFAULTS } from '../constants/visualSettingsPresets';

const POST_PROCESSING_PRESETS = {
    off: { bloomIntensity: 0, vignetteIntensity: 0, chromaticAberrationIntensity: 0, colorCorrection: 50 },
    vibrant: { bloomIntensity: 42, vignetteIntensity: 12, chromaticAberrationIntensity: 0, colorCorrection: 82 },
    desaturated: { bloomIntensity: 24, vignetteIntensity: 70, chromaticAberrationIntensity: 0, colorCorrection: 18 },
} as const;

interface GameVisualSettingsMenuProps {
    onBack: () => void;
    onClose: () => void;
}

type VisualPresetId = 'advanced' | 'performance' | 'custom';

type VisualPresetSnapshot = Pick<
    ReturnType<typeof useSettings>,
    | 'allShadowsEnabled'
    | 'treeShadowsEnabled'
    | 'weatherOverlayEnabled'
    | 'stormAtmosphereEnabled'
    | 'statusOverlaysEnabled'
    | 'grassEnabled'
    | 'grassAnimationEnabled'
    | 'alwaysShowPlayerNames'
    | 'cloudsEnabled'
    | 'waterSurfaceEffectsEnabled'
    | 'waterSurfaceEffectsIntensity'
    | 'worldParticlesQuality'
    | 'footprintsEnabled'
    | 'bloomIntensity'
    | 'vignetteIntensity'
    | 'chromaticAberrationIntensity'
    | 'colorCorrection'
>;

function snapshotMatchesPreset(
    s: VisualPresetSnapshot,
    preset: typeof ADVANCED_VISUAL_DEFAULTS | typeof PERFORMANCE_VISUAL_DEFAULTS
): boolean {
    return (
        s.allShadowsEnabled === preset.allShadowsEnabled &&
        s.treeShadowsEnabled === preset.treeShadowsEnabled &&
        s.weatherOverlayEnabled === preset.weatherOverlayEnabled &&
        s.stormAtmosphereEnabled === preset.stormAtmosphereEnabled &&
        s.statusOverlaysEnabled === preset.statusOverlaysEnabled &&
        s.grassEnabled === preset.grassEnabled &&
        s.grassAnimationEnabled === preset.grassAnimationEnabled &&
        s.alwaysShowPlayerNames === preset.alwaysShowPlayerNames &&
        s.cloudsEnabled === preset.cloudsEnabled &&
        s.waterSurfaceEffectsEnabled === preset.waterSurfaceEffectsEnabled &&
        s.waterSurfaceEffectsIntensity === preset.waterSurfaceEffectsIntensity &&
        s.worldParticlesQuality === preset.worldParticlesQuality &&
        s.footprintsEnabled === preset.footprintsEnabled &&
        s.bloomIntensity === preset.bloomIntensity &&
        s.vignetteIntensity === preset.vignetteIntensity &&
        s.chromaticAberrationIntensity === preset.chromaticAberrationIntensity &&
        s.colorCorrection === preset.colorCorrection
    );
}

function resolveActiveVisualPreset(s: VisualPresetSnapshot): VisualPresetId {
    if (snapshotMatchesPreset(s, ADVANCED_VISUAL_DEFAULTS)) return 'advanced';
    if (snapshotMatchesPreset(s, PERFORMANCE_VISUAL_DEFAULTS)) return 'performance';
    return 'custom';
}

const GameVisualSettingsMenu: React.FC<GameVisualSettingsMenuProps> = ({
    onBack,
    onClose,
}) => {
    const {
        allShadowsEnabled,
        treeShadowsEnabled,
        setAllShadowsEnabled: onAllShadowsChange,
        setTreeShadowsEnabled: onTreeShadowsChange,
        weatherOverlayEnabled,
        setWeatherOverlayEnabled: onWeatherOverlayChange,
        stormAtmosphereEnabled,
        setStormAtmosphereEnabled: onStormAtmosphereChange,
        statusOverlaysEnabled,
        setStatusOverlaysEnabled: onStatusOverlaysChange,
        grassEnabled,
        setGrassEnabled: onGrassChange,
        grassAnimationEnabled,
        setGrassAnimationEnabled: onGrassAnimationEnabledChange,
        alwaysShowPlayerNames,
        setAlwaysShowPlayerNames: onAlwaysShowPlayerNamesChange,
        cloudsEnabled,
        setCloudsEnabled: onCloudsEnabledChange,
        waterSurfaceEffectsEnabled,
        setWaterSurfaceEffectsEnabled: onWaterSurfaceEffectsEnabledChange,
        waterSurfaceEffectsIntensity,
        setWaterSurfaceEffectsIntensity: onWaterSurfaceEffectsIntensityChange,
        worldParticlesQuality,
        setWorldParticlesQuality: onWorldParticlesQualityChange,
        footprintsEnabled,
        setFootprintsEnabled: onFootprintsEnabledChange,
        bloomIntensity,
        setBloomIntensity: onBloomIntensityChange,
        vignetteIntensity,
        setVignetteIntensity: onVignetteIntensityChange,
        chromaticAberrationIntensity,
        setChromaticAberrationIntensity: onChromaticAberrationIntensityChange,
        colorCorrection,
        setColorCorrection: onColorCorrectionChange,
        fixedSimulationMode,
        setFixedSimulationMode: onFixedSimulationModeChange,
        displayRefreshRateHz,
        fixedSimulationEnabled,
    } = useSettings();

    const activeVisualPreset = useMemo(
        () =>
            resolveActiveVisualPreset({
                allShadowsEnabled,
                treeShadowsEnabled,
                weatherOverlayEnabled,
                stormAtmosphereEnabled,
                statusOverlaysEnabled,
                grassEnabled,
                grassAnimationEnabled,
                alwaysShowPlayerNames,
                cloudsEnabled,
                waterSurfaceEffectsEnabled,
                waterSurfaceEffectsIntensity,
                worldParticlesQuality,
                footprintsEnabled,
                bloomIntensity,
                vignetteIntensity,
                chromaticAberrationIntensity,
                colorCorrection,
            }),
        [
            allShadowsEnabled,
            treeShadowsEnabled,
            weatherOverlayEnabled,
            stormAtmosphereEnabled,
            statusOverlaysEnabled,
            grassEnabled,
            grassAnimationEnabled,
            alwaysShowPlayerNames,
            cloudsEnabled,
            waterSurfaceEffectsEnabled,
            waterSurfaceEffectsIntensity,
            worldParticlesQuality,
            footprintsEnabled,
            bloomIntensity,
            vignetteIntensity,
            chromaticAberrationIntensity,
            colorCorrection,
        ]
    );

    const settingCardStyle: React.CSSProperties = {
        marginBottom: '25px',
        padding: '14px 16px',
        borderRadius: '10px',
        border: '1px solid rgba(0, 0, 0, 0.45)',
        background: 'rgba(0, 0, 0, 0.42)',
        boxShadow: 'inset 0 0 10px rgba(0, 0, 0, 0.35)',
    };

    const setShadowsEnabled = (enabled: boolean) => {
        onAllShadowsChange(enabled);
        onTreeShadowsChange(enabled);
    };

    const applyPostProcessingPreset = (preset: keyof typeof POST_PROCESSING_PRESETS) => {
        const values = POST_PROCESSING_PRESETS[preset];
        onBloomIntensityChange(values.bloomIntensity);
        onVignetteIntensityChange(values.vignetteIntensity);
        onChromaticAberrationIntensityChange(values.chromaticAberrationIntensity);
        onColorCorrectionChange(values.colorCorrection);
    };

    const applyPresetAdvancedGraphics = () => {
        const a = ADVANCED_VISUAL_DEFAULTS;
        onAllShadowsChange(a.allShadowsEnabled);
        onTreeShadowsChange(a.treeShadowsEnabled);
        onWeatherOverlayChange(a.weatherOverlayEnabled);
        onStormAtmosphereChange(a.stormAtmosphereEnabled);
        onStatusOverlaysChange(a.statusOverlaysEnabled);
        onAlwaysShowPlayerNamesChange(a.alwaysShowPlayerNames);
        onCloudsEnabledChange(a.cloudsEnabled);
        onWaterSurfaceEffectsEnabledChange(a.waterSurfaceEffectsEnabled);
        onWaterSurfaceEffectsIntensityChange(a.waterSurfaceEffectsIntensity);
        onWorldParticlesQualityChange(a.worldParticlesQuality);
        onFootprintsEnabledChange(a.footprintsEnabled);
        onGrassAnimationEnabledChange(a.grassAnimationEnabled);
        onFixedSimulationModeChange('off');
        applyPostProcessingPreset('off');
    };

    const applyPresetPerformance = () => {
        const p = PERFORMANCE_VISUAL_DEFAULTS;
        onAllShadowsChange(p.allShadowsEnabled);
        onTreeShadowsChange(p.treeShadowsEnabled);
        onWeatherOverlayChange(p.weatherOverlayEnabled);
        onStormAtmosphereChange(p.stormAtmosphereEnabled);
        onStatusOverlaysChange(p.statusOverlaysEnabled);
        onAlwaysShowPlayerNamesChange(p.alwaysShowPlayerNames);
        onCloudsEnabledChange(p.cloudsEnabled);
        onWaterSurfaceEffectsEnabledChange(p.waterSurfaceEffectsEnabled);
        onWaterSurfaceEffectsIntensityChange(p.waterSurfaceEffectsIntensity);
        onWorldParticlesQualityChange(p.worldParticlesQuality);
        onFootprintsEnabledChange(p.footprintsEnabled);
        onGrassAnimationEnabledChange(p.grassAnimationEnabled);
        applyPostProcessingPreset('off');
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onBack();
        }
    };

    const backdropStyle = { background: 'rgba(0, 0, 0, 0.08)', backdropFilter: 'blur(0.5px)' as const };
    const panelBg = 'linear-gradient(145deg, rgba(15, 30, 50, 0.55), rgba(10, 20, 40, 0.62))';

    return (
        <>
            <div
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    ...backdropStyle,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 100000,
                }}
                onClick={handleBackdropClick}
            >

            <div
                className={styles.menuContainer}
                style={{
                    maxWidth: '600px',
                    maxHeight: '80vh',
                    background: panelBg,
                    border: '2px solid #00ff88',
                    borderRadius: '12px',
                    boxShadow: '0 0 30px rgba(0, 255, 136, 0.3), inset 0 0 20px rgba(0, 255, 136, 0.1)',
                    position: 'relative',
                    overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Scan line effect */}
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '2px',
                    background: 'linear-gradient(90deg, transparent, #00ff88, transparent)',
                    animation: 'scanLine 3s linear infinite',
                }} />
                
                <div style={{ textAlign: 'left', marginBottom: '35px' }}>
                    <h2
                        style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '22px',
                            color: '#00ff88',
                            textAlign: 'left',
                            marginBottom: '8px',
                            textShadow: '0 0 10px rgba(0, 255, 136, 0.8), 0 0 20px rgba(0, 255, 136, 0.4)',
                            animation: 'glow 2s ease-in-out infinite alternate',
                            letterSpacing: '2px',
                        }}
                    >
                        VISUAL CORTEX MODULE
                    </h2>
                    <div
                        style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#00ff88',
                            textAlign: 'left',
                            letterSpacing: '1px',
                            opacity: 0.9,
                            textShadow: '0 0 8px rgba(0, 255, 136, 0.6)',
                        }}
                    >
                        Neural Imaging Processing Interface v0.82
                    </div>
                </div>

                {/* Scrollable content area */}
                <div 
                    style={{ 
                        padding: '20px 0',
                        maxHeight: 'calc(80vh - 200px)', // Account for header and buttons
                        overflowY: 'auto',
                        overflowX: 'hidden',
                        paddingRight: '10px', // Space for scrollbar
                    }}
                    className="visual-cortex-scroll"
                >
                    <div style={{
                        marginBottom: '18px',
                        padding: '14px',
                        borderRadius: '10px',
                        border: '1px solid rgba(0, 255, 136, 0.35)',
                        background: 'linear-gradient(135deg, rgba(10, 35, 45, 0.72), rgba(8, 24, 32, 0.84))',
                    }}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '11px',
                            color: '#88ffd8',
                            marginBottom: '10px',
                            letterSpacing: '1px',
                            textAlign: 'left',
                        }}>
                            VISUAL PRESETS
                        </div>
                        <div
                            style={{
                                fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
                                fontSize: '14px',
                                fontWeight: 600,
                                letterSpacing: '0.4px',
                                textAlign: 'left',
                                marginBottom: '10px',
                                lineHeight: 1.45,
                                color: activeVisualPreset === 'advanced'
                                    ? '#7dffc8'
                                    : activeVisualPreset === 'performance'
                                      ? '#7cd8ff'
                                      : '#ffd27a',
                                textShadow:
                                    activeVisualPreset === 'custom'
                                        ? '0 0 12px rgba(255, 210, 122, 0.35)'
                                        : activeVisualPreset === 'performance'
                                          ? '0 0 12px rgba(100, 210, 255, 0.35)'
                                          : '0 0 12px rgba(0, 255, 136, 0.25)',
                            }}
                        >
                            {activeVisualPreset === 'advanced' && '● Active: Advanced Graphics'}
                            {activeVisualPreset === 'performance' && '● Active: Performance'}
                            {activeVisualPreset === 'custom' && '● Active: Custom mix (does not match a preset)'}
                        </div>
                        <div style={{
                            fontFamily: '"Segoe UI", system-ui, -apple-system, sans-serif',
                            fontSize: '14px',
                            color: 'rgba(228, 248, 255, 0.92)',
                            marginBottom: '14px',
                            letterSpacing: '0.02em',
                            textAlign: 'left',
                            lineHeight: 1.55,
                        }}>
                            Shadows, weather, clouds, water FX, full particles, and vegetation animation.
                            Choose <strong style={{ color: '#7cd8ff' }}>Performance</strong>
                            {' '}for a lighter GPU load. You can still fine-tune every option below.
                        </div>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                aria-pressed={activeVisualPreset === 'advanced'}
                                onClick={applyPresetAdvancedGraphics}
                                className={styles.menuButton}
                                style={{
                                    flex: '1 1 160px',
                                    minWidth: '150px',
                                    padding: '10px 12px',
                                    fontSize: '11px',
                                    fontFamily: '"Press Start 2P", cursive',
                                    border:
                                        activeVisualPreset === 'advanced'
                                            ? '2px solid #00ff88'
                                            : '2px solid rgba(0, 255, 136, 0.28)',
                                    boxShadow:
                                        activeVisualPreset === 'advanced'
                                            ? '0 0 18px rgba(0, 255, 136, 0.45), inset 0 0 12px rgba(0, 255, 136, 0.12)'
                                            : 'none',
                                    background:
                                        activeVisualPreset === 'advanced'
                                            ? 'linear-gradient(135deg, rgba(0, 60, 45, 0.85), rgba(0, 35, 28, 0.92))'
                                            : undefined,
                                    opacity: activeVisualPreset === 'advanced' ? 1 : 0.82,
                                }}
                            >
                                ADVANCED GRAPHICS
                                {activeVisualPreset === 'advanced' ? ' ✓' : ''}
                            </button>
                            <button
                                type="button"
                                aria-pressed={activeVisualPreset === 'performance'}
                                onClick={applyPresetPerformance}
                                className={styles.menuButton}
                                style={{
                                    flex: '1 1 160px',
                                    minWidth: '150px',
                                    padding: '10px 12px',
                                    fontSize: '12px',
                                    fontFamily: '"Press Start 2P", cursive',
                                    border:
                                        activeVisualPreset === 'performance'
                                            ? '2px solid #4ec8ff'
                                            : '2px solid rgba(100, 200, 255, 0.28)',
                                    boxShadow:
                                        activeVisualPreset === 'performance'
                                            ? '0 0 18px rgba(80, 190, 255, 0.4), inset 0 0 12px rgba(80, 190, 255, 0.1)'
                                            : 'none',
                                    background:
                                        activeVisualPreset === 'performance'
                                            ? 'linear-gradient(135deg, rgba(15, 45, 70, 0.88), rgba(10, 28, 48, 0.94))'
                                            : undefined,
                                    opacity: activeVisualPreset === 'performance' ? 1 : 0.82,
                                }}
                            >
                                PERFORMANCE
                                {activeVisualPreset === 'performance' ? ' ✓' : ''}
                            </button>
                        </div>
                    </div>

                    <div style={{
                        marginBottom: '16px',
                        fontFamily: '"Press Start 2P", cursive',
                        fontSize: '11px',
                        color: '#66d7ff',
                        letterSpacing: '1px',
                        textAlign: 'left',
                        opacity: 0.9,
                    }}>
                        CORE VISUALS
                    </div>

                    {/* Tree Shadows Setting */}
                    <div style={settingCardStyle}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '16px',
                            color: '#88ff44',
                            marginBottom: '12px',
                            textShadow: '0 0 8px #88ff44',
                            letterSpacing: '1px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                        }}>
                            <FontAwesomeIcon 
                                icon={faTree} 
                                style={{
                                    color: '#88ff44',
                                    textShadow: '0 0 8px #88ff44',
                                    fontSize: '14px',
                                }}
                            />
                            ALL SHADOWS: {allShadowsEnabled ? 'ENABLED' : 'DISABLED'}
                        </div>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#aaffaa',
                            marginBottom: '8px',
                            opacity: 0.7,
                            letterSpacing: '0.5px',
                            textAlign: 'left',
                        }}>
                            {allShadowsEnabled
                                ? 'Dynamic shadows enabled for trees, resources, structures, and overlays'
                                : 'All in-world shadows disabled for maximum clarity/performance'
                            }
                        </div>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: '15px',
                        }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                cursor: 'pointer',
                                fontFamily: '"Press Start 2P", cursive',
                                fontSize: '14px',
                                color: allShadowsEnabled ? '#88ff44' : '#666',
                                textShadow: allShadowsEnabled ? '0 0 5px #88ff44' : 'none',
                                transition: 'all 0.3s ease',
                            }}>
                                <input
                                    type="checkbox"
                                    checked={allShadowsEnabled}
                                    onChange={(e) => setShadowsEnabled(e.target.checked)}
                                    style={{
                                        marginRight: '10px',
                                        transform: 'scale(1.5)',
                                        accentColor: '#00ff88',
                                    }}
                                />
                                ENABLE ALL SHADOWS
                            </label>
                        </div>
                    </div>

                    {/* Weather Precipitation Setting */}
                    <div style={settingCardStyle}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '16px',
                            color: '#44aaff',
                            marginBottom: '12px',
                            textShadow: '0 0 8px #44aaff',
                            letterSpacing: '1px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                        }}>
                            <FontAwesomeIcon 
                                icon={faCloudRain} 
                                style={{
                                    color: '#44aaff',
                                    textShadow: '0 0 8px #44aaff',
                                    fontSize: '14px',
                                }}
                            />
                            PRECIPITATION: {weatherOverlayEnabled ? 'ENABLED' : 'DISABLED'}
                        </div>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#aaccff',
                            marginBottom: '8px',
                            opacity: 0.7,
                            letterSpacing: '0.5px',
                            textAlign: 'left',
                        }}>
                            {weatherOverlayEnabled 
                                ? 'Rain and snow particles enabled' 
                                : 'Rain and snow disabled'
                            }
                        </div>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: '15px',
                        }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                cursor: 'pointer',
                                fontFamily: '"Press Start 2P", cursive',
                                fontSize: '14px',
                                color: weatherOverlayEnabled ? '#44aaff' : '#666',
                                textShadow: weatherOverlayEnabled ? '0 0 5px #44aaff' : 'none',
                                transition: 'all 0.3s ease',
                            }}>
                                <input
                                    type="checkbox"
                                    checked={weatherOverlayEnabled}
                                    onChange={(e) => onWeatherOverlayChange(e.target.checked)}
                                    style={{
                                        marginRight: '10px',
                                        transform: 'scale(1.5)',
                                        accentColor: '#44aaff',
                                    }}
                                />
                                ENABLE RAIN/SNOW
                            </label>
                        </div>
                    </div>

                    {/* Storm Atmosphere Setting */}
                    <div style={settingCardStyle}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '16px',
                            color: '#5cb8ff',
                            marginBottom: '12px',
                            textShadow: '0 0 8px #5cb8ff',
                            letterSpacing: '1px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                        }}>
                            STORM ATMOSPHERE: {stormAtmosphereEnabled ? 'ENABLED' : 'DISABLED'}
                        </div>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#b8dcff',
                            marginBottom: '8px',
                            opacity: 0.7,
                            letterSpacing: '0.5px',
                            textAlign: 'left',
                        }}>
                            {stormAtmosphereEnabled
                                ? 'Storm darkening, desaturation, and mood enabled'
                                : 'No storm tinting/darkening'
                            }
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-start', gap: '15px' }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                cursor: 'pointer',
                                fontFamily: '"Press Start 2P", cursive',
                                fontSize: '14px',
                                color: stormAtmosphereEnabled ? '#5cb8ff' : '#666',
                                textShadow: stormAtmosphereEnabled ? '0 0 5px #5cb8ff' : 'none',
                                transition: 'all 0.3s ease',
                            }}>
                                <input
                                    type="checkbox"
                                    checked={stormAtmosphereEnabled}
                                    onChange={(e) => onStormAtmosphereChange(e.target.checked)}
                                    style={{ marginRight: '10px', transform: 'scale(1.5)', accentColor: '#5cb8ff' }}
                                />
                                ENABLE STORM LOOK
                            </label>
                        </div>
                    </div>

                    {/* Grass Setting - HIDDEN FOR NOW (not deleted) */}
                    {false && (
                    <div style={{ marginBottom: '25px' }}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '16px',
                            color: '#88cc44',
                            marginBottom: '12px',
                            textShadow: '0 0 8px #88cc44',
                            letterSpacing: '1px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                        }}>
                            <FontAwesomeIcon 
                                icon={faLeaf} 
                                style={{
                                    color: '#88cc44',
                                    textShadow: '0 0 8px #88cc44',
                                    fontSize: '14px',
                                }}
                            />
                            GRASS RENDERING: {grassEnabled ? 'ENABLED' : 'DISABLED'}
                        </div>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#aaffaa',
                            marginBottom: '8px',
                            opacity: 0.7,
                            letterSpacing: '0.5px',
                            textAlign: 'left',
                        }}>
                            {grassEnabled 
                                ? 'Grass subscriptions active - may impact performance' 
                                : 'Grass disabled for better performance'
                            }
                        </div>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: '15px',
                        }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                cursor: 'pointer',
                                fontFamily: '"Press Start 2P", cursive',
                                fontSize: '14px',
                                color: grassEnabled ? '#88cc44' : '#666',
                                textShadow: grassEnabled ? '0 0 5px #88cc44' : 'none',
                                transition: 'all 0.3s ease',
                            }}>
                                <input
                                    type="checkbox"
                                    checked={grassEnabled}
                                    onChange={(e) => onGrassChange(e.target.checked)}
                                    style={{
                                        marginRight: '10px',
                                        transform: 'scale(1.5)',
                                        accentColor: '#88cc44',
                                    }}
                                />
                                ENABLE GRASS
                            </label>
                        </div>
                    </div>
                    )}

                    {/* Status Overlays Setting (Cold/Low Health) */}
                    <div style={settingCardStyle}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '16px',
                            color: '#ff5566',
                            marginBottom: '12px',
                            textShadow: '0 0 8px #ff5566',
                            letterSpacing: '1px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                        }}>
                            <FontAwesomeIcon 
                                icon={faHeartPulse} 
                                style={{
                                    color: '#ff5566',
                                    textShadow: '0 0 8px #ff5566',
                                    fontSize: '14px',
                                }}
                            />
                            STATUS OVERLAYS: {statusOverlaysEnabled ? 'ENABLED' : 'DISABLED'}
                        </div>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#ffaaaa',
                            marginBottom: '8px',
                            opacity: 0.7,
                            letterSpacing: '0.5px',
                            textAlign: 'left',
                        }}>
                            {statusOverlaysEnabled 
                                ? 'Screen effects show when cold or low health' 
                                : 'Cold/health screen effects disabled'
                            }
                        </div>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: '15px',
                        }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                cursor: 'pointer',
                                fontFamily: '"Press Start 2P", cursive',
                                fontSize: '14px',
                                color: statusOverlaysEnabled ? '#ff5566' : '#666',
                                textShadow: statusOverlaysEnabled ? '0 0 5px #ff5566' : 'none',
                                transition: 'all 0.3s ease',
                            }}>
                                <input
                                    type="checkbox"
                                    checked={statusOverlaysEnabled}
                                    onChange={(e) => onStatusOverlaysChange(e.target.checked)}
                                    style={{
                                        marginRight: '10px',
                                        transform: 'scale(1.5)',
                                        accentColor: '#ff5566',
                                    }}
                                />
                                ENABLE OVERLAYS
                            </label>
                        </div>
                    </div>

                    {/* Always Show Player Names Setting */}
                    <div style={settingCardStyle}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '16px',
                            color: '#00ffff',
                            marginBottom: '12px',
                            textShadow: '0 0 8px #00ffff',
                            letterSpacing: '1px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                        }}>
                            <FontAwesomeIcon 
                                icon={faUsers} 
                                style={{
                                    color: '#00ffff',
                                    textShadow: '0 0 8px #00ffff',
                                    fontSize: '14px',
                                }}
                            />
                            PLAYER NAMES: {alwaysShowPlayerNames ? 'ALWAYS VISIBLE' : 'HOVER ONLY'}
                        </div>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#aaffff',
                            marginBottom: '8px',
                            opacity: 0.7,
                            letterSpacing: '0.5px',
                            textAlign: 'left',
                        }}>
                            {alwaysShowPlayerNames 
                                ? 'Player names shown above all characters' 
                                : 'Player names shown only when hovering'
                            }
                        </div>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'flex-start',
                            gap: '15px',
                        }}>
                            <label style={{
                                display: 'flex',
                                alignItems: 'center',
                                cursor: 'pointer',
                                fontFamily: '"Press Start 2P", cursive',
                                fontSize: '14px',
                                color: alwaysShowPlayerNames ? '#00ffff' : '#666',
                                textShadow: alwaysShowPlayerNames ? '0 0 5px #00ffff' : 'none',
                                transition: 'all 0.3s ease',
                            }}>
                                <input
                                    type="checkbox"
                                    checked={alwaysShowPlayerNames}
                                    onChange={(e) => onAlwaysShowPlayerNamesChange(e.target.checked)}
                                    style={{
                                        marginRight: '10px',
                                        transform: 'scale(1.5)',
                                        accentColor: '#00ffff',
                                    }}
                                />
                                ALWAYS SHOW NAMES
                            </label>
                        </div>
                    </div>

                    <div style={{
                        marginBottom: '16px',
                        marginTop: '5px',
                        fontFamily: '"Press Start 2P", cursive',
                        fontSize: '11px',
                        color: '#66d7ff',
                        letterSpacing: '1px',
                        textAlign: 'left',
                        opacity: 0.9,
                    }}>
                        PERFORMANCE
                    </div>

                    {/* Clouds Setting */}
                    <div style={settingCardStyle}>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '16px', color: '#a8d9ff', marginBottom: '12px', textShadow: '0 0 8px #a8d9ff', letterSpacing: '1px' }}>
                            CLOUDS: {cloudsEnabled ? 'ENABLED' : 'DISABLED'}
                        </div>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '12px', color: '#d6ebff', marginBottom: '8px', opacity: 0.7, letterSpacing: '0.5px', textAlign: 'left' }}>
                            High-atmosphere cloud layer rendered over world.
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontFamily: '"Press Start 2P", cursive', fontSize: '14px', color: cloudsEnabled ? '#a8d9ff' : '#666', textShadow: cloudsEnabled ? '0 0 5px #a8d9ff' : 'none' }}>
                            <input type="checkbox" checked={cloudsEnabled} onChange={(e) => onCloudsEnabledChange(e.target.checked)} style={{ marginRight: '10px', transform: 'scale(1.5)', accentColor: '#a8d9ff' }} />
                            ENABLE CLOUDS
                        </label>
                    </div>

                    {/* Water Surface Effects */}
                    <div style={settingCardStyle}>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '16px', color: '#55d6ff', marginBottom: '12px', textShadow: '0 0 8px #55d6ff', letterSpacing: '1px' }}>
                            WATER SURFACE FX: {waterSurfaceEffectsEnabled ? 'ENABLED' : 'DISABLED'}
                        </div>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '12px', color: '#baf3ff', marginBottom: '8px', opacity: 0.7, letterSpacing: '0.5px', textAlign: 'left' }}>
                            Voronoi/caustic/ripple water rendering and shoreline treatment.
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontFamily: '"Press Start 2P", cursive', fontSize: '14px', color: waterSurfaceEffectsEnabled ? '#55d6ff' : '#666', textShadow: waterSurfaceEffectsEnabled ? '0 0 5px #55d6ff' : 'none', marginBottom: '10px' }}>
                            <input type="checkbox" checked={waterSurfaceEffectsEnabled} onChange={(e) => onWaterSurfaceEffectsEnabledChange(e.target.checked)} style={{ marginRight: '10px', transform: 'scale(1.5)', accentColor: '#55d6ff' }} />
                            ENABLE WATER FX
                        </label>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '12px', color: '#baf3ff', marginBottom: '8px', opacity: 0.8, letterSpacing: '0.5px' }}>
                            WATER FX INTENSITY: {Math.round(waterSurfaceEffectsIntensity)}%
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={waterSurfaceEffectsIntensity}
                            onChange={(e) => onWaterSurfaceEffectsIntensityChange(parseInt(e.target.value, 10))}
                            disabled={!waterSurfaceEffectsEnabled}
                            style={{ width: '100%', accentColor: '#55d6ff', cursor: waterSurfaceEffectsEnabled ? 'pointer' : 'not-allowed', opacity: waterSurfaceEffectsEnabled ? 1 : 0.5 }}
                        />
                    </div>

                    {/* Particle Quality */}
                    <div style={{ marginBottom: '25px' }}>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '16px', color: '#ffd46a', marginBottom: '12px', textShadow: '0 0 8px #ffd46a', letterSpacing: '1px' }}>
                            WORLD PARTICLES: {worldParticlesQuality === 2 ? 'FULL' : worldParticlesQuality === 1 ? 'LOW' : 'OFF'}
                        </div>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '12px', color: '#ffeab4', marginBottom: '8px', opacity: 0.75, letterSpacing: '0.5px', textAlign: 'left' }}>
                            Controls ambient and combat particles for performance tuning.
                        </div>
                        <select
                            value={worldParticlesQuality}
                            onChange={(e) => onWorldParticlesQualityChange(parseInt(e.target.value, 10))}
                            style={{
                                width: '100%',
                                background: 'rgba(10, 20, 35, 0.9)',
                                color: '#ffeab4',
                                border: '1px solid rgba(255, 212, 106, 0.6)',
                                borderRadius: '6px',
                                padding: '10px',
                                fontFamily: '"Press Start 2P", cursive',
                                fontSize: '11px',
                            }}
                        >
                            <option value={0}>OFF</option>
                            <option value={1}>LOW</option>
                            <option value={2}>FULL</option>
                        </select>
                    </div>

                    {/* Footprints */}
                    <div style={settingCardStyle}>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '16px', color: '#9ce7a5', marginBottom: '12px', textShadow: '0 0 8px #9ce7a5', letterSpacing: '1px' }}>
                            FOOTPRINTS: {footprintsEnabled ? 'ENABLED' : 'DISABLED'}
                        </div>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '12px', color: '#cdf4d2', marginBottom: '8px', opacity: 0.75, letterSpacing: '0.5px', textAlign: 'left' }}>
                            Ground footprints in sand/snow. Cosmetic only.
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontFamily: '"Press Start 2P", cursive', fontSize: '14px', color: footprintsEnabled ? '#9ce7a5' : '#666', textShadow: footprintsEnabled ? '0 0 5px #9ce7a5' : 'none' }}>
                            <input type="checkbox" checked={footprintsEnabled} onChange={(e) => onFootprintsEnabledChange(e.target.checked)} style={{ marginRight: '10px', transform: 'scale(1.5)', accentColor: '#9ce7a5' }} />
                            ENABLE FOOTPRINTS
                        </label>
                    </div>

                    {/* Shared vegetation wind */}
                    <div style={settingCardStyle}>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '16px', color: '#88cc44', marginBottom: '12px', textShadow: '0 0 8px #88cc44', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <FontAwesomeIcon icon={faLeaf} style={{ color: '#88cc44', textShadow: '0 0 8px #88cc44', fontSize: '14px' }} />
                            VEGETATION ANIMATION: {grassAnimationEnabled ? 'ON' : 'OFF'}
                        </div>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '12px', color: '#aaffaa', marginBottom: '8px', opacity: 0.75, letterSpacing: '0.5px', textAlign: 'left' }}>
                            Weather-driven wind on grass, bushes, crops, tree foliage, and kelp. Turn off for a static pose.
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', fontFamily: '"Press Start 2P", cursive', fontSize: '14px', color: grassAnimationEnabled ? '#88cc44' : '#666', textShadow: grassAnimationEnabled ? '0 0 5px #88cc44' : 'none' }}>
                            <input type="checkbox" checked={grassAnimationEnabled} onChange={(e) => onGrassAnimationEnabledChange(e.target.checked)} style={{ marginRight: '10px', transform: 'scale(1.5)', accentColor: '#88cc44' }} />
                            ENABLE VEGETATION ANIMATION
                        </label>
                    </div>

                    {/* Fixed Simulation - Performance / High-refresh tuning */}
                    <div style={settingCardStyle}>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '16px', color: '#b8a0ff', marginBottom: '12px', textShadow: '0 0 8px #b8a0ff', letterSpacing: '1px', display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <FontAwesomeIcon icon={faGears} style={{ color: '#b8a0ff', textShadow: '0 0 8px #b8a0ff', fontSize: '14px' }} />
                            FIXED SIMULATION (30 Hz): {fixedSimulationMode.toUpperCase()}
                        </div>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '12px', color: '#d4c8ff', marginBottom: '8px', opacity: 0.75, letterSpacing: '0.5px', textAlign: 'left' }}>
                            {fixedSimulationMode === 'auto'
                                ? `Auto detected ${displayRefreshRateHz} Hz and is currently ${fixedSimulationEnabled ? 'using fixed 30 Hz simulation' : 'using variable timestep'}.`
                                : fixedSimulationMode === 'on'
                                    ? 'Forced fixed simulation at 30 Hz. Can feel smoother on high-refresh displays.'
                                    : 'Forced variable timestep. Usually smoother/more responsive on 60 Hz displays.'}
                        </div>
                        <div style={{ fontFamily: '"Press Start 2P", cursive', fontSize: '11px', color: '#c7b7ff', marginBottom: '8px', opacity: 0.8, letterSpacing: '0.4px', textAlign: 'left' }}>
                            Hint: if you use 120/144/165 Hz and notice micro-jitter, try AUTO or ON.
                        </div>
                        <select
                            value={fixedSimulationMode}
                            onChange={(e) => onFixedSimulationModeChange(e.target.value as FixedSimulationMode)}
                            style={{
                                width: '100%',
                                background: 'rgba(22, 16, 38, 0.92)',
                                color: '#d4c8ff',
                                border: '1px solid rgba(184, 160, 255, 0.7)',
                                borderRadius: '6px',
                                padding: '10px',
                                fontFamily: '"Press Start 2P", cursive',
                                fontSize: '11px',
                            }}
                        >
                            <option value="off">OFF (VARIABLE TIMESTEP)</option>
                            <option value="auto">AUTO (USE DISPLAY REFRESH)</option>
                            <option value="on">ON (FORCE FIXED 30 HZ)</option>
                        </select>
                    </div>

                    <div style={{
                        marginBottom: '16px',
                        marginTop: '5px',
                        fontFamily: '"Press Start 2P", cursive',
                        fontSize: '11px',
                        color: '#66d7ff',
                        letterSpacing: '1px',
                        textAlign: 'left',
                        opacity: 0.9,
                    }}>
                        POST PROCESSING
                    </div>

                    {/* Bloom Filter Slider */}
                    <div style={settingCardStyle}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '16px',
                            color: '#ffe066',
                            marginBottom: '12px',
                            textShadow: '0 0 8px #ffe066',
                            letterSpacing: '1px',
                        }}>
                            BLOOM FILTER: {Math.round(bloomIntensity)}%
                        </div>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#fff2b8',
                            marginBottom: '10px',
                            opacity: 0.75,
                            letterSpacing: '0.5px',
                            textAlign: 'left',
                        }}>
                            Soft glow on bright areas. Tuned for a cozy, cinematic scene.
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={bloomIntensity}
                            onChange={(e) => onBloomIntensityChange(parseInt(e.target.value, 10))}
                            style={{
                                width: '100%',
                                accentColor: '#ffe066',
                                cursor: 'pointer',
                            }}
                        />
                    </div>

                    {/* Vignette Slider */}
                    <div style={settingCardStyle}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '16px',
                            color: '#d0d8ff',
                            marginBottom: '12px',
                            textShadow: '0 0 8px #d0d8ff',
                            letterSpacing: '1px',
                        }}>
                            VIGNETTE: {Math.round(vignetteIntensity)}%
                        </div>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#dfe5ff',
                            marginBottom: '10px',
                            opacity: 0.75,
                            letterSpacing: '0.5px',
                            textAlign: 'left',
                        }}>
                            Darkens screen edges for depth. Default is intentionally very subtle.
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={vignetteIntensity}
                            onChange={(e) => onVignetteIntensityChange(parseInt(e.target.value, 10))}
                            style={{
                                width: '100%',
                                accentColor: '#d0d8ff',
                                cursor: 'pointer',
                            }}
                        />
                    </div>

                    {/* Chromatic Aberration Slider */}
                    <div style={settingCardStyle}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '16px',
                            color: '#ff9ad1',
                            marginBottom: '12px',
                            textShadow: '0 0 8px #ff9ad1',
                            letterSpacing: '1px',
                        }}>
                            CHROMATIC ABERRATION: {Math.round(chromaticAberrationIntensity)}%
                        </div>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#ffc5e6',
                            marginBottom: '10px',
                            opacity: 0.75,
                            letterSpacing: '0.5px',
                            textAlign: 'left',
                        }}>
                            Adds a subtle red/green edge split for film-like lens character.
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={chromaticAberrationIntensity}
                            onChange={(e) => onChromaticAberrationIntensityChange(parseInt(e.target.value, 10))}
                            style={{
                                width: '100%',
                                accentColor: '#ff9ad1',
                                cursor: 'pointer',
                            }}
                        />
                    </div>

                    {/* Saturation Slider */}
                    <div style={settingCardStyle}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '16px',
                            color: '#8effd1',
                            marginBottom: '12px',
                            textShadow: '0 0 8px #8effd1',
                            letterSpacing: '1px',
                        }}>
                            SATURATION: {Math.round(colorCorrection)}%
                        </div>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#c6ffe8',
                            marginBottom: '10px',
                            opacity: 0.75,
                            letterSpacing: '0.5px',
                            textAlign: 'left',
                        }}>
                            Adjusts color intensity of the world. 50% is neutral.
                        </div>
                        <input
                            type="range"
                            min={0}
                            max={100}
                            step={1}
                            value={colorCorrection}
                            onChange={(e) => onColorCorrectionChange(parseInt(e.target.value, 10))}
                            style={{
                                width: '100%',
                                accentColor: '#8effd1',
                                cursor: 'pointer',
                            }}
                        />
                    </div>

                    {/* Slider Preset Actions */}
                    <div style={{
                        marginBottom: '25px',
                        padding: '14px',
                        borderRadius: '10px',
                        border: '1px solid rgba(180, 255, 220, 0.3)',
                        background: 'linear-gradient(135deg, rgba(12, 32, 36, 0.65), rgba(8, 22, 28, 0.75))',
                        boxShadow: 'inset 0 0 12px rgba(120, 255, 200, 0.1)',
                    }}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '11px',
                            color: '#a8ffd8',
                            opacity: 0.8,
                            marginBottom: '10px',
                            textAlign: 'left',
                            letterSpacing: '0.7px',
                        }}>
                            POST-PROCESSING PRESETS
                        </div>
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                            <button
                                onClick={() => applyPostProcessingPreset('off')}
                                className={styles.menuButton}
                                style={{
                                    flex: '1 1 170px',
                                    minWidth: '150px',
                                    background: 'linear-gradient(135deg, rgba(70, 28, 28, 0.88), rgba(45, 15, 15, 0.96))',
                                    color: '#ffffff',
                                    border: '2px solid #ff7a7a',
                                    borderRadius: '8px',
                                    padding: '12px 14px',
                                    fontFamily: '"Press Start 2P", cursive',
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease',
                                    boxShadow: '0 0 15px rgba(255, 122, 122, 0.35), inset 0 0 10px rgba(255, 122, 122, 0.12)',
                                    textShadow: '0 0 5px rgba(255, 122, 122, 0.85)',
                                    letterSpacing: '1px',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(95, 35, 35, 0.96), rgba(60, 18, 18, 1))';
                                    e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                                    e.currentTarget.style.boxShadow = '0 0 25px rgba(255, 122, 122, 0.6), inset 0 0 15px rgba(255, 122, 122, 0.2)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'linear-gradient(135deg, rgba(70, 28, 28, 0.88), rgba(45, 15, 15, 0.96))';
                                    e.currentTarget.style.transform = 'translateY(0px) scale(1)';
                                    e.currentTarget.style.boxShadow = '0 0 15px rgba(255, 122, 122, 0.35), inset 0 0 10px rgba(255, 122, 122, 0.12)';
                                }}
                            >
                                OFF (DEFAULT)
                            </button>
                            <button
                                onClick={() => applyPostProcessingPreset('vibrant')}
                                className={styles.menuButton}
                                style={{
                                    flex: '1 1 170px',
                                    minWidth: '150px',
                                    background: 'linear-gradient(135deg, rgba(72, 22, 78, 0.88), rgba(56, 14, 62, 0.96))',
                                    color: '#ffffff',
                                    border: '2px solid #ff82e6',
                                    borderRadius: '8px',
                                    padding: '12px 14px',
                                    fontFamily: '"Press Start 2P", cursive',
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease',
                                    boxShadow: '0 0 15px rgba(255, 130, 230, 0.35), inset 0 0 10px rgba(255, 130, 230, 0.12)',
                                    textShadow: '0 0 5px rgba(255, 130, 230, 0.85)',
                                    letterSpacing: '1px',
                                }}
                            >
                                VIBRANT
                            </button>
                            <button
                                onClick={() => applyPostProcessingPreset('desaturated')}
                                className={styles.menuButton}
                                style={{
                                    flex: '1 1 170px',
                                    minWidth: '150px',
                                    background: 'linear-gradient(135deg, rgba(45, 40, 35, 0.88), rgba(30, 25, 20, 0.96))',
                                    color: '#ffffff',
                                    border: '2px solid #8a8a8a',
                                    borderRadius: '8px',
                                    padding: '12px 14px',
                                    fontFamily: '"Press Start 2P", cursive',
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease',
                                    boxShadow: '0 0 15px rgba(120, 115, 110, 0.35), inset 0 0 10px rgba(120, 115, 110, 0.12)',
                                    textShadow: '0 0 5px rgba(140, 135, 130, 0.85)',
                                    letterSpacing: '1px',
                                }}
                            >
                                DESATURATED
                            </button>
                        </div>
                    </div>

                </div>

                <div className={styles.menuButtons}>
                    <button 
                        onClick={onBack}
                        className={styles.menuButton}
                        style={{
                            background: 'linear-gradient(135deg, rgba(80, 40, 20, 0.8), rgba(60, 30, 15, 0.9))',
                            color: '#ffffff',
                            border: '2px solid #ff8833',
                            borderRadius: '8px',
                            padding: '15px 30px',
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '16px',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 0 15px rgba(255, 136, 51, 0.3), inset 0 0 10px rgba(255, 136, 51, 0.1)',
                            textShadow: '0 0 5px rgba(255, 136, 51, 0.8)',
                            letterSpacing: '1px',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(100, 50, 25, 0.9), rgba(80, 40, 20, 1))';
                            e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                            e.currentTarget.style.boxShadow = '0 0 25px rgba(255, 136, 51, 0.6), inset 0 0 15px rgba(255, 136, 51, 0.2)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(80, 40, 20, 0.8), rgba(60, 30, 15, 0.9))';
                            e.currentTarget.style.transform = 'translateY(0px) scale(1)';
                            e.currentTarget.style.boxShadow = '0 0 15px rgba(255, 136, 51, 0.3), inset 0 0 10px rgba(255, 136, 51, 0.1)';
                        }}
                    >
                        NEURAL INTERFACE MENU
                    </button>
                    <button
                        onClick={onClose}
                        className={`${styles.menuButton} ${styles.menuButtonPrimary}`}
                        style={{
                            background: 'linear-gradient(135deg, rgba(20, 40, 80, 0.8), rgba(10, 30, 70, 0.9))',
                            color: '#ffffff',
                            border: '2px solid #00aaff',
                            borderRadius: '8px',
                            padding: '15px 30px',
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '16px',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 0 15px rgba(0, 170, 255, 0.3), inset 0 0 10px rgba(0, 170, 255, 0.1)',
                            textShadow: '0 0 5px rgba(0, 170, 255, 0.8)',
                            letterSpacing: '1px',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(30, 50, 100, 0.9), rgba(15, 40, 90, 1))';
                            e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                            e.currentTarget.style.boxShadow = '0 0 25px rgba(0, 170, 255, 0.6), inset 0 0 15px rgba(0, 170, 255, 0.2)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(20, 40, 80, 0.8), rgba(10, 30, 70, 0.9))';
                            e.currentTarget.style.transform = 'translateY(0px) scale(1)';
                            e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 170, 255, 0.3), inset 0 0 10px rgba(0, 170, 255, 0.1)';
                        }}
                    >
                        RESUME CONSCIOUSNESS
                    </button>
                </div>
                
                <style>{`
                    @keyframes scanLine {
                        0% { transform: translateX(-100%); }
                        100% { transform: translateX(100%); }
                    }
                    
                    @keyframes glow {
                        0% { 
                            text-shadow: 0 0 10px rgba(0, 255, 136, 0.8), 0 0 20px rgba(0, 255, 136, 0.4);
                        }
                        100% { 
                            text-shadow: 0 0 15px rgba(0, 255, 136, 1), 0 0 30px rgba(0, 255, 136, 0.6);
                        }
                    }
                    
                    /* Cyberpunk styled scrollbar */
                    .visual-cortex-scroll::-webkit-scrollbar {
                        width: 8px;
                    }
                    
                    .visual-cortex-scroll::-webkit-scrollbar-track {
                        background: rgba(0, 20, 40, 0.8);
                        border-radius: 4px;
                        border: 1px solid rgba(0, 255, 136, 0.2);
                    }
                    
                    .visual-cortex-scroll::-webkit-scrollbar-thumb {
                        background: linear-gradient(180deg, #00ff88 0%, #00aa66 100%);
                        border-radius: 4px;
                        box-shadow: 0 0 8px rgba(0, 255, 136, 0.5);
                    }
                    
                    .visual-cortex-scroll::-webkit-scrollbar-thumb:hover {
                        background: linear-gradient(180deg, #00ffaa 0%, #00cc88 100%);
                        box-shadow: 0 0 12px rgba(0, 255, 136, 0.8);
                    }
                    
                    /* Firefox scrollbar */
                    .visual-cortex-scroll {
                        scrollbar-width: thin;
                        scrollbar-color: #00ff88 rgba(0, 20, 40, 0.8);
                    }
                `}</style>
            </div>
            </div>
        </>
    );
};

export default GameVisualSettingsMenu;
