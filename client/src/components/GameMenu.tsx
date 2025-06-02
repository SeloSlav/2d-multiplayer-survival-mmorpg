import React from 'react';

export type MenuType = 'main' | 'controls' | 'tips' | null;

interface GameMenuProps {
    onClose: () => void;
    onNavigate: (menu: MenuType) => void;
}

const GameMenu: React.FC<GameMenuProps> = ({ onClose, onNavigate }) => {
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
        }
    };

    const menuOptions = [
        { label: 'Back to Game', action: () => onClose() },
        { label: 'Controls', action: () => onNavigate('controls') },
        { label: 'Game Tips', action: () => onNavigate('tips') },
    ];

    return (
        <div
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 2000,
            }}
            onClick={handleBackdropClick}
        >
            <div
                style={{
                    backgroundColor: 'rgba(40, 40, 60, 0.95)',
                    border: '3px solid #a0a0c0',
                    borderRadius: '8px',
                    padding: '40px',
                    minWidth: '300px',
                    boxShadow: '4px 4px 0px rgba(0,0,0,0.8)',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h2
                    style={{
                        fontFamily: '"Press Start 2P", cursive',
                        fontSize: '18px',
                        color: 'white',
                        textAlign: 'center',
                        marginBottom: '30px',
                        textShadow: '2px 2px 0px rgba(0,0,0,0.8)',
                    }}
                >
                    Game Menu
                </h2>
                
                <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    {menuOptions.map((option, index) => (
                        <button
                            key={index}
                            onClick={option.action}
                            style={{
                                backgroundColor: 'rgba(60, 60, 80, 0.8)',
                                color: 'white',
                                border: '2px solid #a0a0c0',
                                borderRadius: '4px',
                                padding: '12px 20px',
                                fontFamily: '"Press Start 2P", cursive',
                                fontSize: '12px',
                                cursor: 'pointer',
                                transition: 'all 0.1s ease',
                                boxShadow: '2px 2px 0px rgba(0,0,0,0.5)',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(80, 80, 100, 0.9)';
                                e.currentTarget.style.transform = 'translateY(-1px)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = 'rgba(60, 60, 80, 0.8)';
                                e.currentTarget.style.transform = 'translateY(0px)';
                            }}
                        >
                            {option.label}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default GameMenu; 