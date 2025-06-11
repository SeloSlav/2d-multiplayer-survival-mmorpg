import React from 'react';

interface GameMenuButtonProps {
    onClick: () => void;
}

const GameMenuButton: React.FC<GameMenuButtonProps> = ({ onClick }) => {
    return (
        <button
            onClick={onClick}
            style={{
                position: 'absolute',
                top: '15px',
                left: '15px',
                zIndex: 999,
                background: 'linear-gradient(135deg, rgba(20, 40, 80, 0.9), rgba(10, 30, 70, 0.95))',
                color: '#00ffff',
                border: '2px solid #00aaff',
                borderRadius: '8px',
                padding: '10px 15px',
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '12px',
                cursor: 'pointer',
                boxShadow: '0 0 15px rgba(0, 170, 255, 0.4), inset 0 0 10px rgba(0, 170, 255, 0.1)',
                transition: 'all 0.3s ease',
                textShadow: '0 0 8px rgba(0, 255, 255, 0.8)',
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(30, 50, 100, 0.95), rgba(15, 40, 90, 1))';
                e.currentTarget.style.transform = 'translateY(-2px) scale(1.05)';
                e.currentTarget.style.boxShadow = '0 0 25px rgba(0, 170, 255, 0.7), inset 0 0 15px rgba(0, 170, 255, 0.2)';
                e.currentTarget.style.textShadow = '0 0 12px rgba(0, 255, 255, 1), 0 0 20px rgba(0, 255, 255, 0.6)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.background = 'linear-gradient(135deg, rgba(20, 40, 80, 0.9), rgba(10, 30, 70, 0.95))';
                e.currentTarget.style.transform = 'translateY(0px) scale(1)';
                e.currentTarget.style.boxShadow = '0 0 15px rgba(0, 170, 255, 0.4), inset 0 0 10px rgba(0, 170, 255, 0.1)';
                e.currentTarget.style.textShadow = '0 0 8px rgba(0, 255, 255, 0.8)';
            }}
        >
            Menu
        </button>
    );
};

export default GameMenuButton; 