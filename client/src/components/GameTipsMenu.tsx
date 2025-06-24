import React, { useRef } from 'react';
import styles from './MenuComponents.module.css';
import { tipSections } from '../utils/gameKnowledgeExtractor';

interface GameTipsMenuProps {
    onBack: () => void;
    onClose: () => void;
}

const GameTipsMenu: React.FC<GameTipsMenuProps> = ({ onBack, onClose }) => {
    const contentRef = useRef<HTMLDivElement>(null);

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onBack();
        }
    };

    // Function to scroll to a specific section
    const scrollToSection = (sectionIndex: number) => {
        if (contentRef.current) {
            const sectionElements = contentRef.current.querySelectorAll('[data-section]');
            const targetSection = sectionElements[sectionIndex] as HTMLElement;
            if (targetSection) {
                targetSection.scrollIntoView({ 
                    behavior: 'smooth', 
                    block: 'start' 
                });
            }
        }
    };

    // Extract emojis from section titles for the table of contents
    const sectionEmojis = tipSections.map(section => {
        const emojiMatch = section.title.match(/^(\p{Emoji})/u);
        return emojiMatch ? emojiMatch[1] : '📖';
    });

    const sectionNames = tipSections.map(section => {
        return section.title.replace(/^(\p{Emoji})\s*/u, '');
    });

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
                        marginBottom: '15px',
                        textShadow: '0 0 10px rgba(0, 255, 255, 0.8), 0 0 20px rgba(0, 255, 255, 0.4)',
                    }}
                >
                    SURVIVAL DATABANK
                </h2>

                {/* Table of Contents */}
                <div style={{
                    display: 'flex',
                    justifyContent: 'center',
                    flexWrap: 'wrap',
                    gap: '8px',
                    marginBottom: '20px',
                    padding: '10px 15px',
                    background: 'linear-gradient(135deg, rgba(10, 20, 40, 0.8), rgba(5, 15, 35, 0.9))',
                    borderRadius: '8px',
                    border: '1px solid rgba(0, 255, 255, 0.2)',
                    margin: '0 15px 20px 15px',
                }}>
                    {sectionEmojis.map((emoji, index) => (
                        <div
                            key={index}
                            style={{
                                position: 'relative',
                                display: 'inline-block',
                            }}
                        >
                            <button
                                onClick={() => scrollToSection(index)}
                                style={{
                                    background: 'linear-gradient(135deg, rgba(20, 30, 60, 0.8), rgba(15, 25, 50, 0.9))',
                                    border: '2px solid rgba(0, 170, 255, 0.4)',
                                    borderRadius: '6px',
                                    padding: '8px 10px',
                                    fontSize: '16px',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease',
                                    boxShadow: '0 0 8px rgba(0, 170, 255, 0.2)',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.transform = 'scale(1.1)';
                                    e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 170, 255, 0.4)';
                                    e.currentTarget.style.borderColor = 'rgba(0, 170, 255, 0.8)';
                                    // Show tooltip
                                    const tooltip = e.currentTarget.nextElementSibling as HTMLElement;
                                    if (tooltip) tooltip.style.opacity = '1';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.transform = 'scale(1)';
                                    e.currentTarget.style.boxShadow = '0 0 8px rgba(0, 170, 255, 0.2)';
                                    e.currentTarget.style.borderColor = 'rgba(0, 170, 255, 0.4)';
                                    // Hide tooltip
                                    const tooltip = e.currentTarget.nextElementSibling as HTMLElement;
                                    if (tooltip) tooltip.style.opacity = '0';
                                }}
                            >
                                {emoji}
                            </button>
                            {/* Tooltip */}
                            <div
                                style={{
                                    position: 'absolute',
                                    bottom: '100%',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    marginBottom: '8px',
                                    padding: '6px 10px',
                                    background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.95), rgba(20, 20, 20, 0.98))',
                                    color: '#00ffff',
                                    border: '1px solid #00ffff',
                                    borderRadius: '4px',
                                    fontSize: '10px',
                                    fontFamily: '"Press Start 2P", cursive',
                                    whiteSpace: 'nowrap',
                                    opacity: 0,
                                    pointerEvents: 'none',
                                    transition: 'opacity 0.3s ease',
                                    zIndex: 1000,
                                    textShadow: '0 0 5px rgba(0, 255, 255, 0.8)',
                                    boxShadow: '0 0 10px rgba(0, 255, 255, 0.3)',
                                }}
                            >
                                {sectionNames[index]}
                                <div style={{
                                    position: 'absolute',
                                    top: '100%',
                                    left: '50%',
                                    transform: 'translateX(-50%)',
                                    width: 0,
                                    height: 0,
                                    borderLeft: '5px solid transparent',
                                    borderRight: '5px solid transparent',
                                    borderTop: '5px solid #00ffff',
                                }} />
                            </div>
                        </div>
                    ))}
                </div>

                <div 
                    ref={contentRef}
                    data-scrollable-region="tips-content"
                    className={`${styles.scrollableSection} ${styles.menuContent}`}
                >
                    {tipSections.map((section, sectionIndex) => (
                        <div key={sectionIndex} data-section={sectionIndex}>
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