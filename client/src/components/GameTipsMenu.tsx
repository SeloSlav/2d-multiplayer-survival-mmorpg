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
                'Heavy rain will extinguish campfires, so build shelters for protection.',
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
                    maxWidth: '500px',
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
                    SURVIVAL DATABANK
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
                                    color: '#00aaff',
                                    marginBottom: '15px',
                                    textShadow: '0 0 8px rgba(0, 170, 255, 0.8)',
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
                                            padding: '15px 18px',
                                            background: 'linear-gradient(135deg, rgba(20, 30, 60, 0.6), rgba(15, 25, 50, 0.8))',
                                            borderRadius: '8px',
                                            border: '1px solid rgba(0, 170, 255, 0.3)',
                                            boxShadow: '0 0 10px rgba(0, 170, 255, 0.1), inset 0 0 5px rgba(0, 170, 255, 0.05)',
                                        }}
                                    >
                                        <span
                                            style={{
                                                fontFamily: '"Press Start 2P", cursive',
                                                fontSize: '14px',
                                                color: '#ffdd44',
                                                marginRight: '12px',
                                                marginTop: '2px',
                                                textShadow: '0 0 6px rgba(255, 221, 68, 0.6)',
                                            }}
                                        >
                                            •
                                        </span>
                                        <span
                                            style={{
                                                fontFamily: '"Press Start 2P", cursive',
                                                fontSize: '12px',
                                                color: '#ffffff',
                                                lineHeight: '1.7',
                                                flex: 1,
                                                textAlign: 'left',
                                                wordWrap: 'break-word',
                                                overflowWrap: 'break-word',
                                                hyphens: 'auto',
                                                textShadow: '0 0 4px rgba(255, 255, 255, 0.4)',
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

export default GameTipsMenu; 