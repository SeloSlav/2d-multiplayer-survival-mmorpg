import React from 'react';
import styles from './MenuComponents.module.css';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTree } from '@fortawesome/free-solid-svg-icons';

// Default visual settings based on optimal neural rendering thresholds
export const DEFAULT_VISUAL_SETTINGS = {
    treeShadowsEnabled: true,        // Enable tree shadows
} as const;

interface GameVisualSettingsMenuProps {
    onBack: () => void;
    onClose: () => void;
    treeShadowsEnabled: boolean;
    onTreeShadowsChange: (enabled: boolean) => void;
}

const GameVisualSettingsMenu: React.FC<GameVisualSettingsMenuProps> = ({
    onBack,
    onClose,
    treeShadowsEnabled,
    onTreeShadowsChange,
}) => {
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onBack();
        }
    };

    return (
        <>
            <div
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'linear-gradient(135deg, rgba(10, 25, 40, 0.95), rgba(5, 15, 30, 0.98))',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 100000,
                    backdropFilter: 'blur(8px)',
                }}
                onClick={handleBackdropClick}
            >

            <div
                className={styles.menuContainer}
                style={{
                    maxWidth: '600px',
                    maxHeight: '80vh',
                    background: 'linear-gradient(145deg, rgba(15, 30, 50, 0.95), rgba(10, 20, 40, 0.98))',
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
                            color: '#6699cc',
                            textAlign: 'left',
                            letterSpacing: '1px',
                            opacity: 0.8,
                        }}
                    >
                        Neural Imaging Processing Interface v0.53
                    </div>
                </div>

                <div style={{ padding: '20px 0' }}>
                    <div style={{ marginBottom: '25px' }}>
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
                            TREE SHADOWS: {treeShadowsEnabled ? 'ENABLED' : 'DISABLED'}
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
                            {treeShadowsEnabled 
                                ? 'Performance may decrease in dense forests' 
                                : 'Disabled for better performance'
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
                                color: treeShadowsEnabled ? '#88ff44' : '#666',
                                textShadow: treeShadowsEnabled ? '0 0 5px #88ff44' : 'none',
                                transition: 'all 0.3s ease',
                            }}>
                                <input
                                    type="checkbox"
                                    checked={treeShadowsEnabled}
                                    onChange={(e) => onTreeShadowsChange(e.target.checked)}
                                    style={{
                                        marginRight: '10px',
                                        transform: 'scale(1.5)',
                                        accentColor: '#00ff88',
                                    }}
                                />
                                ENABLE SHADOWS
                            </label>
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
                `}</style>
            </div>
            </div>
        </>
    );
};

export default GameVisualSettingsMenu; 