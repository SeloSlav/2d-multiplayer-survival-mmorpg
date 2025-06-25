import React from 'react';

interface GameSettingsMenuProps {
    onBack: () => void;
    musicVolume: number;
    soundVolume: number;
    onMusicVolumeChange: (volume: number) => void;
    onSoundVolumeChange: (volume: number) => void;
}

const GameSettingsMenu: React.FC<GameSettingsMenuProps> = ({
    onBack,
    musicVolume,
    soundVolume,
    onMusicVolumeChange,
    onSoundVolumeChange,
}) => {
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onBack();
        }
    };

    const formatVolume = (volume: number) => `${Math.round(volume * 100)}%`;

    return (
        <>

            
            <div
                style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: 'linear-gradient(135deg, rgba(25, 10, 40, 0.95), rgba(15, 5, 30, 0.98))',
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    zIndex: 100000,
                    backdropFilter: 'blur(8px)',
                }}
                onClick={handleBackdropClick}
            >

            <div
                style={{
                    background: 'linear-gradient(145deg, rgba(30, 15, 50, 0.95), rgba(20, 10, 40, 0.98))',
                    border: '2px solid #00ffff',
                    borderRadius: '12px',
                    padding: '40px',
                    minWidth: '450px',
                    boxShadow: '0 0 30px rgba(0, 255, 255, 0.3), inset 0 0 20px rgba(0, 255, 255, 0.1)',
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
                    background: 'linear-gradient(90deg, transparent, #00ffff, transparent)',
                    animation: 'scanLine 3s linear infinite',
                }} />
                
                <div style={{ textAlign: 'center', marginBottom: '35px' }}>
                    <h2
                        style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '22px',
                            color: '#00ffff',
                            textAlign: 'center',
                            marginBottom: '8px',
                            textShadow: '0 0 10px rgba(0, 255, 255, 0.8), 0 0 20px rgba(0, 255, 255, 0.4)',
                            animation: 'glow 2s ease-in-out infinite alternate',
                            letterSpacing: '2px',
                        }}
                    >
                        AUDIO SETTINGS
                    </h2>
                    <div
                        style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#6699cc',
                            textAlign: 'center',
                            letterSpacing: '1px',
                            opacity: 0.8,
                        }}
                    >
                        Audio Management Interface v2.1
                    </div>
                </div>
                
                <div style={{ padding: '20px 0' }}>
                    <div style={{ marginBottom: '25px' }}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#ff6b9d',
                            marginBottom: '12px',
                            textShadow: '0 0 8px #ff6b9d',
                            letterSpacing: '1px',
                        }}>
                            SOUNDTRACK VOLUME: {Math.round(musicVolume * 100)}%
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={musicVolume}
                            onChange={(e) => onMusicVolumeChange(parseFloat(e.target.value))}
                            style={{
                                width: '100%',
                                margin: '8px 0',
                            }}
                        />
                    </div>
                    
                    <div style={{ marginBottom: '25px' }}>
                        <div style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '12px',
                            color: '#4ecdc4',
                            marginBottom: '12px',
                            textShadow: '0 0 8px #4ecdc4',
                            letterSpacing: '1px',
                        }}>
                            SOUND EFFECTS VOLUME: {Math.round(soundVolume * 100)}%
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="1"
                            step="0.05"
                            value={soundVolume}
                            onChange={(e) => onSoundVolumeChange(parseFloat(e.target.value))}
                            style={{
                                width: '100%',
                                margin: '8px 0',
                            }}
                        />
                    </div>
                </div>
                
                <div style={{ textAlign: 'center', marginTop: '30px' }}>
                    <button
                        onClick={onBack}
                        style={{
                            background: 'linear-gradient(135deg, rgba(20, 40, 80, 0.8), rgba(10, 30, 70, 0.9))',
                            color: '#ffffff',
                            border: '2px solid #00aaff',
                            borderRadius: '8px',
                            padding: '15px 30px',
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '13px',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 0 15px rgba(0, 170, 255, 0.3), inset 0 0 10px rgba(0, 170, 255, 0.1)',
                            textShadow: '0 0 5px currentColor',
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
                        ← BACK TO MENU
                    </button>
                </div>
                
                <style>{`
                    @keyframes scanLine {
                        0% { transform: translateX(-100%); }
                        100% { transform: translateX(100%); }
                    }
                    
                    @keyframes glow {
                        0% { 
                            text-shadow: 0 0 10px rgba(0, 255, 255, 0.8), 0 0 20px rgba(0, 255, 255, 0.4);
                        }
                        100% { 
                            text-shadow: 0 0 15px rgba(0, 255, 255, 1), 0 0 30px rgba(0, 255, 255, 0.6);
                        }
                    }
                `}</style>
            </div>
        </div>
        </>
    );
};

export default GameSettingsMenu; 