import React from 'react';
import { useAuth } from '../contexts/AuthContext';

export type MenuType = 'main' | 'controls' | 'tips' | null;

interface GameMenuProps {
    onClose: () => void;
    onNavigate: (menu: MenuType) => void;
}

const GameMenu: React.FC<GameMenuProps> = ({ onClose, onNavigate }) => {
    const { logout } = useAuth();
    
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    const handleSignOut = async () => {
        onClose(); // Close the menu first
        await logout(); // Then sign out
    };

    const menuOptions = [
        { label: 'Back to Game', action: () => onClose() },
        { label: 'Controls', action: () => onNavigate('controls') },
        { label: 'Game Tips', action: () => onNavigate('tips') },
        { label: 'Sign Out', action: handleSignOut, isSignOut: true },
    ];

    return (
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
                zIndex: 2000,
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
                
                <h2
                    style={{
                        fontFamily: '"Press Start 2P", cursive',
                        fontSize: '20px',
                        color: '#00ffff',
                        textAlign: 'center',
                        marginBottom: '30px',
                        textShadow: '0 0 10px rgba(0, 255, 255, 0.8), 0 0 20px rgba(0, 255, 255, 0.4)',
                        animation: 'glow 2s ease-in-out infinite alternate',
                    }}
                >
                    NEURAL INTERFACE
                </h2>
                
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
                                fontSize: '12px',
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
                            {option.label}
                        </button>
                    ))}
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
    );
};

export default GameMenu; 