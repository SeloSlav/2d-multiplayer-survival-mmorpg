import React, { useEffect, useCallback } from 'react';

interface ImageGalleryProps {
  images: Array<{
    src: string;
    alt: string;
    caption?: string;
  }>;
  currentIndex: number;
  isOpen: boolean;
  onClose: () => void;
  onNavigate: (index: number) => void;
}

const ImageGallery: React.FC<ImageGalleryProps> = ({
  images,
  currentIndex,
  isOpen,
  onClose,
  onNavigate,
}) => {
  // Handle keyboard navigation
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isOpen) return;
    
    switch (e.key) {
      case 'Escape':
        onClose();
        break;
      case 'ArrowLeft':
        e.preventDefault();
        onNavigate(currentIndex > 0 ? currentIndex - 1 : images.length - 1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        onNavigate(currentIndex < images.length - 1 ? currentIndex + 1 : 0);
        break;
    }
  }, [isOpen, currentIndex, images.length, onClose, onNavigate]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden'; // Prevent background scrolling
    } else {
      document.body.style.overflow = 'auto';
    }
    
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'auto';
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen || images.length === 0) return null;

  const currentImage = images[currentIndex];

  const handlePrevious = () => {
    onNavigate(currentIndex > 0 ? currentIndex - 1 : images.length - 1);
  };

  const handleNext = () => {
    onNavigate(currentIndex < images.length - 1 ? currentIndex + 1 : 0);
  };

  const handleOverlayClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        padding: '20px',
        boxSizing: 'border-box',
      }}
      onClick={handleOverlayClick}
    >
      {/* Close Button */}
      <button
        onClick={onClose}
        style={{
          position: 'absolute',
          top: '20px',
          right: '20px',
          background: 'rgba(0, 170, 255, 0.2)',
          border: '2px solid #00aaff',
          borderRadius: '50%',
          width: '50px',
          height: '50px',
          color: '#00aaff',
          fontSize: '24px',
          fontWeight: 'bold',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transition: 'all 0.3s ease',
          fontFamily: "'Courier New', Consolas, Monaco, monospace",
          zIndex: 10001,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 170, 255, 0.4)';
          e.currentTarget.style.borderColor = '#00ddff';
          e.currentTarget.style.color = '#00ddff';
          e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 170, 255, 0.5)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = 'rgba(0, 170, 255, 0.2)';
          e.currentTarget.style.borderColor = '#00aaff';
          e.currentTarget.style.color = '#00aaff';
          e.currentTarget.style.boxShadow = 'none';
        }}
      >
        ×
      </button>

      {/* Image Container */}
      <div
        style={{
          position: 'relative',
          maxWidth: '90%',
          maxHeight: '90%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
        }}
      >
        {/* Main Image */}
        <div
          style={{
            position: 'relative',
            borderRadius: '8px',
            overflow: 'hidden',
            border: '2px solid #00aaff',
            boxShadow: '0 0 30px rgba(0, 170, 255, 0.4)',
            lineHeight: 0,
          }}
        >
          <img
            src={currentImage.src}
            alt={currentImage.alt}
            style={{
              maxWidth: '80vw',
              maxHeight: '70vh',
              width: 'auto',
              height: 'auto',
              display: 'block',
              filter: 'brightness(1) contrast(1.1)',
            }}
          />
        </div>

        {/* Image Caption */}
        {currentImage.caption && (
          <p
            style={{
              color: '#e0e0e0',
              fontSize: '14px',
              textAlign: 'center',
              margin: '15px 0 0 0',
              maxWidth: '600px',
              lineHeight: '1.5',
              fontFamily: "'Courier New', Consolas, Monaco, monospace",
              textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
            }}
          >
            {currentImage.caption}
          </p>
        )}

        {/* Image Counter */}
        <div
          style={{
            color: '#99ccff',
            fontSize: '12px',
            margin: '10px 0 0 0',
            fontFamily: "'Courier New', Consolas, Monaco, monospace",
            opacity: 0.8,
          }}
        >
          {currentIndex + 1} of {images.length}
        </div>
      </div>

      {/* Navigation Arrows */}
      {images.length > 1 && (
        <>
          {/* Previous Button */}
          <button
            onClick={handlePrevious}
            style={{
              position: 'absolute',
              left: '20px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'rgba(0, 170, 255, 0.2)',
              border: '2px solid #00aaff',
              borderRadius: '50%',
              width: '60px',
              height: '60px',
              color: '#00aaff',
              fontSize: '28px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease',
              fontFamily: "'Courier New', Consolas, Monaco, monospace",
              zIndex: 10001,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(0, 170, 255, 0.4)';
              e.currentTarget.style.borderColor = '#00ddff';
              e.currentTarget.style.color = '#00ddff';
              e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 170, 255, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(0, 170, 255, 0.2)';
              e.currentTarget.style.borderColor = '#00aaff';
              e.currentTarget.style.color = '#00aaff';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            ‹
          </button>

          {/* Next Button */}
          <button
            onClick={handleNext}
            style={{
              position: 'absolute',
              right: '20px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'rgba(0, 170, 255, 0.2)',
              border: '2px solid #00aaff',
              borderRadius: '50%',
              width: '60px',
              height: '60px',
              color: '#00aaff',
              fontSize: '28px',
              fontWeight: 'bold',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.3s ease',
              fontFamily: "'Courier New', Consolas, Monaco, monospace",
              zIndex: 10001,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(0, 170, 255, 0.4)';
              e.currentTarget.style.borderColor = '#00ddff';
              e.currentTarget.style.color = '#00ddff';
              e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 170, 255, 0.5)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(0, 170, 255, 0.2)';
              e.currentTarget.style.borderColor = '#00aaff';
              e.currentTarget.style.color = '#00aaff';
              e.currentTarget.style.boxShadow = 'none';
            }}
          >
            ›
          </button>
        </>
      )}
    </div>
  );
};

export default ImageGallery; 