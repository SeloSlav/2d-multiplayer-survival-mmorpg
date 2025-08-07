import React from 'react';
import { useAuth } from '../contexts/AuthContext';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faVolumeUp, faEye, faGamepad, faLightbulb, IconDefinition } from '@fortawesome/free-solid-svg-icons';

export type MenuType = 'main' | 'controls' | 'tips' | 'settings' | 'visual_settings' | null;

interface MenuOption {
    label: string;
    action: () => void;
    icon?: IconDefinition;
    isSignOut?: boolean;
}

interface GameMenuProps {
    onClose: () => void;
    onNavigate: (menu: MenuType) => void;
    musicVolume?: number;
    soundVolume?: number;
    onMusicVolumeChange?: (volume: number) => void;
    onSoundVolumeChange?: (volume: number) => void;
}

const GameMenu: React.FC<GameMenuProps> = ({ 
    onClose, 
    onNavigate, 
    musicVolume = 0.25, 
    soundVolume = 0.8, 
    onMusicVolumeChange, 
    onSoundVolumeChange 
}) => {
    const { logout } = useAuth();
    const [showSignOutConfirm, setShowSignOutConfirm] = React.useState(false);
    
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    const handleSignOutRequest = () => {
        setShowSignOutConfirm(true);
    };

    const handleSignOutConfirm = async () => {
        setShowSignOutConfirm(false);
        onClose(); // Close the menu first
        await logout(); // Then sign out
    };

    const handleSignOutCancel = () => {
        setShowSignOutConfirm(false);
    };

    const menuOptions: MenuOption[] = [
        { label: 'RESUME CONSCIOUSNESS', action: () => onClose() },
        { label: 'AUDITORY CORTEX MODULE', action: () => onNavigate('settings'), icon: faVolumeUp },
        { label: 'VISUAL CORTEX MODULE', action: () => onNavigate('visual_settings'), icon: faEye },
        { label: 'MOTOR CORTEX INTERFACE', action: () => onNavigate('controls'), icon: faGamepad },
        { label: 'TACTICAL KNOWLEDGE MATRIX', action: () => onNavigate('tips'), icon: faLightbulb },
        { label: 'FORCE NEURAL SLEEP', action: handleSignOutRequest, isSignOut: true },
    ];

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                background: 'linear-gradient(135deg, #1a0d2e 0%, #16213e 50%, #0f1419 100%)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 2000,
                backdropFilter: 'blur(8px)',
                overflow: 'hidden',
            }}
            onClick={handleBackdropClick}
        >
            {/* Animated grid background */}
            <div 
                className="grid-background"
                style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    backgroundImage: `
                        linear-gradient(rgba(0, 221, 255, 0.3) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0, 221, 255, 0.3) 1px, transparent 1px),
                        linear-gradient(rgba(0, 150, 255, 0.15) 1px, transparent 1px),
                        linear-gradient(90deg, rgba(0, 150, 255, 0.15) 1px, transparent 1px)
                    `,
                    backgroundSize: '50px 50px, 50px 50px, 10px 10px, 10px 10px',
                    animation: 'grid-move 20s linear infinite',
                    opacity: 0.7,
                    pointerEvents: 'none',
                }}
            />
            <div
                style={{
                    background: 'linear-gradient(145deg, rgba(30, 15, 50, 0.95), rgba(20, 10, 40, 0.98))',
                    border: '2px solid #00ffff',
                    borderRadius: '12px',
                    padding: '40px',
                    minWidth: '350px',
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
                
                <div style={{ textAlign: 'center', marginBottom: '30px' }}>
                    <h2
                        style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '24px',
                            color: '#00ffff',
                            textAlign: 'center',
                            marginBottom: '8px',
                            textShadow: '0 0 10px rgba(0, 255, 255, 0.8), 0 0 20px rgba(0, 255, 255, 0.4)',
                            animation: 'glow 2s ease-in-out infinite alternate',
                            letterSpacing: '2px',
                        }}
                    >
                        NEUROVEIL™ OCULAR INTERFACE
                    </h2>
                    <div
                        style={{
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '14px',
                            color: '#6699cc',
                            textAlign: 'center',
                            letterSpacing: '1px',
                            opacity: 0.8,
                            lineHeight: '1.4',
                        }}
                    >
                        <div>ООО "Rozhkov Neuroscience"</div>
                        <div>System v0.53</div>
                    </div>
                </div>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {menuOptions.map((option, index) => (
                        <button
                            key={index}
                            onClick={option.action}
                            style={{
                                background: option.isSignOut 
                                    ? 'linear-gradient(135deg, rgba(120, 20, 40, 0.8), rgba(80, 10, 30, 0.9))' 
                                    : 'linear-gradient(135deg, rgba(20, 40, 80, 0.8), rgba(10, 30, 70, 0.9))',
                                color: '#ffffff',
                                border: option.isSignOut ? '2px solid #ff3366' : '2px solid #00aaff',
                                borderRadius: '8px',
                                padding: '15px 25px',
                                fontFamily: '"Press Start 2P", cursive',
                                fontSize: '14px',
                                cursor: 'pointer',
                                transition: 'all 0.3s ease',
                                boxShadow: option.isSignOut 
                                    ? '0 0 15px rgba(255, 51, 102, 0.3), inset 0 0 10px rgba(255, 51, 102, 0.1)' 
                                    : '0 0 15px rgba(0, 170, 255, 0.3), inset 0 0 10px rgba(0, 170, 255, 0.1)',
                                textShadow: '0 0 5px currentColor',
                                position: 'relative',
                                overflow: 'hidden',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.background = option.isSignOut 
                                    ? 'linear-gradient(135deg, rgba(150, 30, 50, 0.9), rgba(100, 15, 35, 1))' 
                                    : 'linear-gradient(135deg, rgba(30, 50, 100, 0.9), rgba(15, 40, 90, 1))';
                                e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                                e.currentTarget.style.boxShadow = option.isSignOut 
                                    ? '0 0 25px rgba(255, 51, 102, 0.6), inset 0 0 15px rgba(255, 51, 102, 0.2)' 
                                    : '0 0 25px rgba(0, 170, 255, 0.6), inset 0 0 15px rgba(0, 170, 255, 0.2)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.background = option.isSignOut 
                                    ? 'linear-gradient(135deg, rgba(120, 20, 40, 0.8), rgba(80, 10, 30, 0.9))' 
                                    : 'linear-gradient(135deg, rgba(20, 40, 80, 0.8), rgba(10, 30, 70, 0.9))';
                                e.currentTarget.style.transform = 'translateY(0px) scale(1)';
                                e.currentTarget.style.boxShadow = option.isSignOut 
                                    ? '0 0 15px rgba(255, 51, 102, 0.3), inset 0 0 10px rgba(255, 51, 102, 0.1)' 
                                    : '0 0 15px rgba(0, 170, 255, 0.3), inset 0 0 10px rgba(0, 170, 255, 0.1)';
                            }}
                        >
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'flex-start',
                                gap: '12px',
                                width: '100%',
                                paddingLeft: '8px',
                            }}>
                                <div style={{
                                    width: '20px',
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                }}>
                                    {option.icon && (
                                        <FontAwesomeIcon 
                                            icon={option.icon} 
                                            style={{
                                                fontSize: '16px',
                                                color: 'currentColor',
                                            }}
                                        />
                                    )}
                                </div>
                                <span>{option.label}</span>
                            </div>
                        </button>
                    ))}
                </div>
                
                {/* Neural Sleep Confirmation Dialog */}
                {showSignOutConfirm && (
                    <div 
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            width: '100%',
                            height: '100%',
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            zIndex: 10000,
                        }}
                        onClick={handleSignOutCancel}
                    >
                        <div 
                            style={{
                                background: 'linear-gradient(145deg, rgba(40, 20, 60, 0.98), rgba(30, 15, 50, 0.99))',
                                border: '2px solid #ff3366',
                                borderRadius: '12px',
                                padding: '30px',
                                maxWidth: '450px',
                                textAlign: 'center',
                                boxShadow: '0 0 40px rgba(255, 51, 102, 0.4), inset 0 0 20px rgba(255, 51, 102, 0.1)',
                                position: 'relative',
                                overflow: 'hidden',
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Warning scan line */}
                            <div style={{
                                position: 'absolute',
                                top: 0,
                                left: 0,
                                right: 0,
                                height: '2px',
                                background: 'linear-gradient(90deg, transparent, #ff3366, transparent)',
                                animation: 'scanLine 2s linear infinite',
                            }} />
                            
                            <div style={{
                                color: '#ff6699',
                                fontSize: '18px',
                                marginBottom: '15px',
                                textShadow: '0 0 10px rgba(255, 102, 153, 0.8)',
                                fontFamily: '"Press Start 2P", cursive',
                                letterSpacing: '1px',
                            }}>
                                ⚠️ NEURAL SLEEP PROTOCOL ⚠️
                            </div>
                            
                            <div style={{
                                color: '#ffffff',
                                fontSize: '14px',
                                lineHeight: '1.8',
                                marginBottom: '25px',
                                padding: '20px',
                                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                                borderRadius: '8px',
                                border: '1px solid rgba(255, 51, 102, 0.3)',
                                fontFamily: '"Press Start 2P", cursive',
                            }}>
                                WARNING: Initiating neural sleep will disconnect your consciousness from the SOVA survival matrix.
                                <br /><br />
                                Your physical body will remain vulnerable in the world while your neural pathways are severed.
                                <br /><br />
                                Are you certain you wish to force neural sleep?
                            </div>

                            <div style={{
                                display: 'flex',
                                gap: '15px',
                                justifyContent: 'center',
                            }}>
                                <button
                                    onClick={handleSignOutConfirm}
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(120, 20, 40, 0.8), rgba(80, 10, 30, 0.9))',
                                        color: '#ffffff',
                                        border: '2px solid #ff3366',
                                        borderRadius: '8px',
                                        padding: '15px 25px',
                                        fontFamily: '"Press Start 2P", cursive',
                                        fontSize: '12px',
                                        cursor: 'pointer',
                                        transition: 'all 0.3s ease',
                                        boxShadow: '0 0 15px rgba(255, 51, 102, 0.3), inset 0 0 10px rgba(255, 51, 102, 0.1)',
                                        textShadow: '0 0 5px currentColor',
                                        letterSpacing: '1px',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(150, 30, 50, 0.9), rgba(100, 15, 35, 1))';
                                        e.currentTarget.style.transform = 'translateY(-2px) scale(1.02)';
                                        e.currentTarget.style.boxShadow = '0 0 25px rgba(255, 51, 102, 0.6), inset 0 0 15px rgba(255, 51, 102, 0.2)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'linear-gradient(135deg, rgba(120, 20, 40, 0.8), rgba(80, 10, 30, 0.9))';
                                        e.currentTarget.style.transform = 'translateY(0px) scale(1)';
                                        e.currentTarget.style.boxShadow = '0 0 15px rgba(255, 51, 102, 0.3), inset 0 0 10px rgba(255, 51, 102, 0.1)';
                                    }}
                                >
                                    CONFIRM NEURAL SLEEP
                                </button>
                                
                                <button
                                    onClick={handleSignOutCancel}
                                    style={{
                                        background: 'linear-gradient(135deg, rgba(20, 40, 80, 0.8), rgba(10, 30, 70, 0.9))',
                                        color: '#ffffff',
                                        border: '2px solid #00aaff',
                                        borderRadius: '8px',
                                        padding: '15px 25px',
                                        fontFamily: '"Press Start 2P", cursive',
                                        fontSize: '12px',
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
                                    MAINTAIN CONNECTION
                                </button>
                            </div>
                        </div>
                    </div>
                )}
                
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
                    
                    @keyframes holodeck-pulse {
                        0% { opacity: 0.3; }
                        100% { opacity: 0.8; }
                    }
                    
                    .grid-background::before {
                        content: '';
                        position: absolute;
                        top: 0;
                        left: 0;
                        width: 100%;
                        height: 100%;
                        background: 
                            radial-gradient(circle at 25% 25%, rgba(0, 221, 255, 0.1) 0%, transparent 50%),
                            radial-gradient(circle at 75% 75%, rgba(0, 150, 255, 0.1) 0%, transparent 50%);
                        animation: holodeck-pulse 8s ease-in-out infinite alternate;
                        pointer-events: none;
                    }
                `}</style>
            </div>
        </div>
    );
};

export default GameMenu; 