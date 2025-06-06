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
                { key: 'W, A, S, D', description: 'Move player' },
                { key: 'Left Shift', description: 'Sprint (hold)' },
                { key: 'Space', description: 'Jump' },
                { key: 'C', description: 'Crouch' },
                { key: 'F', description: 'Toggle auto-walk' },
                { key: 'W/A/S/D (during auto-walk)', description: 'Override auto-walk direction' },
                { key: 'Shift + W/A/S/D', description: 'Cancel auto-walk and sprint' },
                { key: 'Q', description: 'Dodge roll (8-directional, 10 stamina)' },
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
                backgroundColor: 'rgba(0, 0, 0, 0.7)',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                zIndex: 2000,
            }}
            onClick={handleBackdropClick}
        >
            <div
                className={styles.menuContainer}
                style={{
                    maxWidth: '600px',
                    maxHeight: '80vh',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className={styles.menuTitle}>
                    Controls
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
                                    color: '#a0a0c0',
                                    marginBottom: '15px',
                                    textShadow: '1px 1px 0px rgba(0,0,0,0.8)',
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
                                            padding: '8px 12px',
                                            backgroundColor: 'rgba(60, 60, 80, 0.6)',
                                            borderRadius: '4px',
                                            border: '1px solid rgba(160, 160, 192, 0.3)',
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontFamily: '"Press Start 2P", cursive',
                                                fontSize: '12px',
                                                color: '#ffdd44',
                                                fontWeight: 'bold',
                                                minWidth: '120px',
                                                textAlign: 'left',
                                            }}
                                        >
                                            {control.key}
                                        </span>
                                        <span
                                            style={{
                                                fontFamily: '"Press Start 2P", cursive',
                                                fontSize: '12px',
                                                color: 'white',
                                                textAlign: 'left',
                                                flex: 1,
                                                marginLeft: '20px',
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
                    >
                        Back to Menu
                    </button>
                    <button
                        onClick={onClose}
                        className={`${styles.menuButton} ${styles.menuButtonPrimary}`}
                    >
                        Back to Game
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ControlsMenu; 