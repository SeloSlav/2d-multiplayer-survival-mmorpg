import React from 'react';
import styles from './MenuComponents.module.css';

interface ControlsMenuProps {
    onBack: () => void;
    onClose: () => void;
}

const ControlsMenu: React.FC<ControlsMenuProps> = ({ onBack, onClose }) => {
    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onBack();
        }
    };

    // Add escape key handler
    React.useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                onBack(); // Return to main menu instead of closing entirely
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
        };
    }, [onBack]);

    const controlSections = [
        {
            title: 'Movement',
            controls: [
                { key: 'W/A/S/D', description: 'Move player' },
                { key: 'Left Shift', description: 'Sprint (hold)' },
                { key: 'Space', description: 'Jump (standing still) / Dodge roll (with movement)' },
                { key: 'C', description: 'Crouch' },
                { key: 'Q', description: 'Toggle auto-walk' },
                { key: 'Shift + W/A/S/D', description: 'Cancel auto-walk and sprint' },
            ]
        },
        {
            title: 'Interaction',
            controls: [
                { key: 'Left Click', description: 'Use equipped tool/weapon' },
                { key: 'E (Hold)', description: 'Pick up empty wooden storage boxes' },
                { key: 'E (Hold)', description: 'Toggle campfire on/off' },
                { key: 'E (Hold)', description: 'Hide/surface stashes' },
                { key: 'E (Hold)', description: 'Revive knocked out players' },
            ]
        },
        {
            title: 'Inventory & Hotbar',
            controls: [
                { key: 'Tab', description: 'Toggle inventory' },
                { key: '1-6', description: 'Select hotbar slot' },
                { key: 'Mouse Wheel', description: 'Cycle through hotbar slots' },
                { key: 'Right Click', description: 'Quick move items between containers' },
            ]
        },
        {
            title: 'Interface',
            controls: [
                { key: 'Enter', description: 'Open chat' },
                { key: 'Escape', description: 'Close menus/cancel actions' },
                { key: 'G', description: 'Toggle minimap' },
                { key: 'V (Hold)', description: 'Talk to SOVA personal AI assistant' },
            ]
        },
        {
            title: 'Combat',
            controls: [
                { key: 'Left Click', description: 'Attack with equipped weapon' },
                { key: 'Left Click', description: 'Shoot with ranged weapons' },
                { key: 'Right Click', description: 'Set arrows / Toggle arrow types' },
                { key: 'Right Click', description: 'Throw equipped melee weapons' },
                { key: 'Z', description: 'Toggle auto attack' },
                { key: 'Consumables', description: 'Click twice on hotbar to consume' },
            ]
        }
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
                className={styles.menuContainer}
                style={{
                    maxWidth: '600px',
                    maxHeight: '80vh',
                    background: 'linear-gradient(145deg, rgba(30, 15, 50, 0.95), rgba(20, 10, 40, 0.98))',
                    border: '2px solid #00ffff',
                    borderRadius: '12px',
                    boxShadow: '0 0 30px rgba(0, 255, 255, 0.3), inset 0 0 20px rgba(0, 255, 255, 0.1)',
                    position: 'relative',
                    overflow: 'hidden',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className={styles.menuTitle}
                    style={{
                        fontFamily: '"Press Start 2P", cursive',
                        fontSize: '18px',
                        color: '#00ffff',
                        textAlign: 'center',
                        marginBottom: '25px',
                        textShadow: '0 0 10px rgba(0, 255, 255, 0.8), 0 0 20px rgba(0, 255, 255, 0.4)',
                    }}
                >
                    NEURAL CONTROL INTERFACE
                </h2>

                <div 
                    data-scrollable-region="controls-content"
                    className={`${styles.scrollableSection} ${styles.menuContent}`}
                >
                    {controlSections.map((section, sectionIndex) => (
                        <div key={sectionIndex}>
                            <h3
                                style={{
                                    fontFamily: '"Press Start 2P", cursive',
                                    fontSize: '14px',
                                    color: '#00aaff',
                                    marginBottom: '15px',
                                    textShadow: '0 0 8px rgba(0, 170, 255, 0.8)',
                                }}
                            >
                                {section.title}
                            </h3>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {section.controls.map((control, controlIndex) => (
                                    <div
                                        key={controlIndex}
                                        style={{
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                            alignItems: 'center',
                                            padding: '10px 15px',
                                            background: 'linear-gradient(135deg, rgba(20, 30, 60, 0.6), rgba(15, 25, 50, 0.8))',
                                            borderRadius: '6px',
                                            border: '1px solid rgba(0, 170, 255, 0.3)',
                                            boxShadow: '0 0 10px rgba(0, 170, 255, 0.1), inset 0 0 5px rgba(0, 170, 255, 0.05)',
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontFamily: '"Press Start 2P", cursive',
                                                fontSize: '11px',
                                                color: '#ffdd44',
                                                fontWeight: 'bold',
                                                minWidth: '120px',
                                                textAlign: 'left',
                                                textShadow: '0 0 6px rgba(255, 221, 68, 0.6)',
                                            }}
                                        >
                                            {control.key}
                                        </span>
                                        <span
                                            style={{
                                                fontFamily: '"Press Start 2P", cursive',
                                                fontSize: '11px',
                                                color: '#ffffff',
                                                textAlign: 'left',
                                                flex: 1,
                                                marginLeft: '20px',
                                                textShadow: '0 0 4px rgba(255, 255, 255, 0.4)',
                                            }}
                                        >
                                            {control.description}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
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
                            padding: '12px 20px',
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '11px',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 0 15px rgba(255, 136, 51, 0.3), inset 0 0 10px rgba(255, 136, 51, 0.1)',
                            textShadow: '0 0 5px rgba(255, 136, 51, 0.8)',
                        }}
                    >
                        Back to Menu
                    </button>
                    <button
                        onClick={onClose}
                        className={`${styles.menuButton} ${styles.menuButtonPrimary}`}
                        style={{
                            background: 'linear-gradient(135deg, rgba(20, 40, 80, 0.8), rgba(10, 30, 70, 0.9))',
                            color: '#ffffff',
                            border: '2px solid #00aaff',
                            borderRadius: '8px',
                            padding: '12px 20px',
                            fontFamily: '"Press Start 2P", cursive',
                            fontSize: '11px',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 0 15px rgba(0, 170, 255, 0.3), inset 0 0 10px rgba(0, 170, 255, 0.1)',
                            textShadow: '0 0 5px rgba(0, 170, 255, 0.8)',
                        }}
                    >
                        Back to Game
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ControlsMenu; 