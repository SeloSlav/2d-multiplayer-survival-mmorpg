import React from 'react';
import styles from './MenuComponents.module.css';

interface GameTipsMenuProps {
    onBack: () => void;
    onClose: () => void;
}

const GameTipsMenu: React.FC<GameTipsMenuProps> = ({ onBack, onClose }) => {
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

    const tipSections = [
        {
            title: 'Getting Started',
            tips: [
                'Start by collecting basic resources like wood from trees and stone from rocks.',
                'Craft a wooden axe and pickaxe as your first tools for efficient gathering.',
                'Build a campfire early for cooking food and providing light at night.',
                'Place a sleeping bag to set your respawn point.',
            ]
        },
        {
            title: 'Survival Tips',
            tips: [
                'Keep an eye on your health, hunger, and thirst meters.',
                'Cooked food provides better nutrition than raw food.',
                'Stay near light sources at night - darkness can be dangerous.',
                'Rain will extinguish campfires, so build shelters for protection.',
                'You can use plant fibers in campfire but they burn twice as fast as wood.',
            ]
        },
        {
            title: 'Combat & Safety',
            tips: [
                'Craft weapons and armor to defend yourself from threats.',
                'Bandages can heal you over time - keep some in your hotbar.',
                'If knocked out, other players can revive you by holding E.',
                'Store valuable items in wooden storage boxes inside shelters to protect them from other players.',
                'Shelters are cheap to make and difficult to destroy, but have limited space and you cannot attack enemies from inside them.',
            ]
        },
        {
            title: 'Building & Crafting',
            tips: [
                'Use the crafting menu (Tab) to see available recipes.',
                'Some recipes require specific tools or stations to craft.',
                'Build shelters to protect your campfires from rain.',
                'Stashes can be hidden underground - useful for secret storage.',
                'Shelters provide an ambient warmth bonus so you wont freeze as quickly during the night.',
            ]
        },
        {
            title: 'Food',
            tips: [
                'Mushrooms can be found scattered around the world.',
                'Cooked food provides better health and hunger restoration.',
                'Corn grows naturally in grassy areas - look for tall green stalks.',
                'Pumpkins provide substantial nutrition and can be cooked for better effects.',
                'Hemp plants grow in clusters and provide fiber for crafting.',
                'Hemp is essential for making rope and other advanced crafting materials.',
            ]
        },
        {
            title: 'Multiplayer Tips',
            tips: [
                'Cooperation with other players can help you survive longer.',
                'Use the chat system (Enter) to communicate.',
                'Be careful who you trust - not all players are friendly.',
                'Consider building in groups for better defense and resource sharing.',
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
                    maxWidth: '700px',
                    maxHeight: '80vh',
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <h2 className={styles.menuTitle}>
                    Game Tips
                </h2>

                <div 
                    data-scrollable-region="tips-content"
                    className={`${styles.scrollableSection} ${styles.menuContent}`}
                >
                    {tipSections.map((section, sectionIndex) => (
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
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                {section.tips.map((tip, tipIndex) => (
                                    <div
                                        key={tipIndex}
                                        style={{
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            padding: '12px 15px',
                                            backgroundColor: 'rgba(60, 60, 80, 0.6)',
                                            borderRadius: '4px',
                                            border: '1px solid rgba(160, 160, 192, 0.3)',
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontFamily: '"Press Start 2P", cursive',
                                                fontSize: '14px',
                                                color: '#ffdd44',
                                                marginRight: '10px',
                                                marginTop: '2px',
                                            }}
                                        >
                                            •
                                        </span>
                                        <span
                                            style={{
                                                fontFamily: '"Press Start 2P", cursive',
                                                fontSize: '12px',
                                                color: 'white',
                                                lineHeight: '1.6',
                                                flex: 1,
                                                textAlign: 'left',
                                            }}
                                        >
                                            {tip}
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

export default GameTipsMenu; 