import React, { useRef, useEffect, useState } from 'react';
import InterfaceTabs from './InterfaceTabs';
import './InterfaceContainer.css';

interface InterfaceContainerProps {
  children: React.ReactNode;
  canvasWidth: number;
  canvasHeight: number;
  style?: React.CSSProperties;
  onClose: () => void;
}

const InterfaceContainer: React.FC<InterfaceContainerProps> = ({
  children,
  canvasWidth,
  canvasHeight,
  style,
  onClose,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [currentView, setCurrentView] = useState<'minimap'>('minimap');

  // Click outside to close
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onClose]);

  // Block specific mouse events from reaching the game, but allow input interactions
  const handleMouseEvent = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    
    // Don't block events on input elements
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }
    
    // Don't block events on canvas elements (let the minimap handle them)
    if (target.tagName === 'CANVAS') {
      return;
    }
    
    e.stopPropagation();
    // Don't call preventDefault on all events - causes issues with passive listeners
  };

  // Separate handler for wheel events to avoid passive listener issues
  const handleWheelEvent = (e: React.WheelEvent) => {
    const target = e.target as HTMLElement;
    
    // Don't block wheel events on input elements
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }
    
    // Don't block wheel events on canvas elements
    if (target.tagName === 'CANVAS') {
      return;
    }
    
    e.stopPropagation();
    // Don't call preventDefault - causes passive listener issues
  };

  // Separate handler for context menu events
  const handleContextMenuEvent = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    
    // Don't block context menu on input elements
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
      return;
    }
    
    e.stopPropagation();
    e.preventDefault(); // Safe to call preventDefault on context menu events
  };

  return (
    <div
      ref={containerRef}
      className="interface-container"
      style={{
        position: 'absolute',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 1000,
        ...style,
      }}
      onMouseDown={handleMouseEvent}
      onMouseUp={handleMouseEvent}
      onClick={handleMouseEvent}
      onWheel={handleWheelEvent}
      onContextMenu={handleContextMenuEvent}
    >
      <InterfaceTabs
        currentView={currentView}
        onViewChange={setCurrentView}
        className="interface-tabs"
      />
      
      <button
        className="close-button"
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '-40px',
          right: '0px',
          width: '40px',
          height: '40px',
          background: 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)',
          border: '2px solid #ef4444',
          borderRadius: '8px 8px 0 0',
          color: '#ffffff',
          fontSize: '18px',
          fontWeight: 'bold',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001,
          transition: 'all 0.2s ease',
          boxShadow: '0 0 8px rgba(239, 68, 68, 0.5)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = 'linear-gradient(135deg, #dc2626 0%, #b91c1c 100%)';
          e.currentTarget.style.boxShadow = '0 0 12px rgba(239, 68, 68, 0.7)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)';
          e.currentTarget.style.boxShadow = '0 0 8px rgba(239, 68, 68, 0.5)';
        }}
      >
        ×
      </button>
      
      <div className="interface-content">
        {children}
      </div>
    </div>
  );
};

export default InterfaceContainer; 