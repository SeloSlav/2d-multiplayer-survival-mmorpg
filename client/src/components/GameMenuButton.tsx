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
                backgroundColor: 'rgba(40, 40, 60, 0.9)',
                color: 'white',
                border: '2px solid #a0a0c0',
                borderRadius: '4px',
                padding: '8px 12px',
                fontFamily: '"Press Start 2P", cursive',
                fontSize: '12px',
                cursor: 'pointer',
                boxShadow: '2px 2px 0px rgba(0,0,0,0.5)',
                transition: 'all 0.1s ease',
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(60, 60, 80, 0.9)';
                e.currentTarget.style.transform = 'translateY(-1px)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'rgba(40, 40, 60, 0.9)';
                e.currentTarget.style.transform = 'translateY(0px)';
            }}
        >
            Menu
        </button>
    );
};

export default GameMenuButton; 