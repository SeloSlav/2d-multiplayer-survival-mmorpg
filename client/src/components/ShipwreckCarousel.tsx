import React, { useState, useEffect } from 'react';
import combatLadle from '../assets/combat_ladle.png';
import ocularImplant from '../assets/ocular_implant.png';
import fieldCauldron from '../assets/field_cauldron.png';

interface CarouselItem {
    title: string;
    description: string;
    icon: string;
}

const carouselItems: CarouselItem[] = [
    {
        title: "Neuroveil™ Ocular Implant",
        description: "Miraculously intact after the shipwreck, this cutting-edge device was designed in Gred by Rozhkov Neuroscience. Powered by bioelectrical stimulation, it never runs out of batteries. Scan your environment for resources, receive tactical advice, detect threats, and unlock hidden secrets.",
        icon: ocularImplant,
    },
    {
        title: "Combat Ladle",
        description: "Your trusty kitchen ladle doubles as both a weapon and cooking tool. Use it to stir soups and broths - better ladles create superior broths with enhanced stat bonuses and special effects. Upgrade it with tungsten plating for extra damage or add a retractable blade for surprise attacks.",
        icon: combatLadle,
    },
    {
        title: "Cerametal Field Cauldron",
        description: "Your Scavenger-grade Cerametal Field Cauldron, Mk.I is where you actually brew life-sustaining broths and sterilize contaminated water. Must be placed on a campfire to function, but can cook much faster when positioned over natural geysers and steam vents you discover in the world.",
        icon: fieldCauldron,
    },
];

const ShipwreckCarousel: React.FC = () => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isAnimating, setIsAnimating] = useState(false);

    const nextSlide = () => {
        if (isAnimating) return;
        setIsAnimating(true);
        setCurrentIndex((prevIndex) => (prevIndex + 1) % carouselItems.length);
    };

    const prevSlide = () => {
        if (isAnimating) return;
        setIsAnimating(true);
        setCurrentIndex((prevIndex) => (prevIndex - 1 + carouselItems.length) % carouselItems.length);
    };

    const goToSlide = (index: number) => {
        if (isAnimating || index === currentIndex) return;
        setIsAnimating(true);
        setCurrentIndex(index);
    };

    useEffect(() => {
        const timer = setTimeout(() => setIsAnimating(false), 300);
        return () => clearTimeout(timer);
    }, [currentIndex]);

    const getItemPosition = (index: number) => {
        const diff = index - currentIndex;
        if (diff === 0) return 'center';
        if (diff === 1 || diff === -(carouselItems.length - 1)) return 'right';
        if (diff === -1 || diff === carouselItems.length - 1) return 'left';
        return 'hidden';
    };

    return (
        <div style={{
            position: 'relative',
            width: '100%',
            maxWidth: '800px',
            margin: '0 auto',
            height: 'clamp(500px, 70vw, 600px)',
            overflow: 'hidden',
        }}>
            {/* Carousel Container */}
            <div style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
            }}>
                {carouselItems.map((item, index) => {
                    const position = getItemPosition(index);
                    const isCenter = position === 'center';
                    const isVisible = position !== 'hidden';

                    return (
                        <div
                            key={index}
                            style={{
                                position: 'absolute',
                                width: isCenter ? 'clamp(350px, 55vw, 450px)' : 'clamp(180px, 30vw, 200px)',
                                height: isCenter ? 'clamp(480px, 65vw, 550px)' : 'clamp(200px, 35vw, 250px)',
                                backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                border: isCenter ? '2px solid rgba(255, 255, 255, 0.4)' : '1px solid rgba(255, 255, 255, 0.2)',
                                borderRadius: '16px',
                                padding: isCenter ? 'clamp(24px, 4vw, 32px)' : '20px',
                                display: isVisible ? 'flex' : 'none',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                textAlign: 'center',
                                transition: 'all 0.3s ease',
                                transform: `translateX(${
                                    position === 'left' ? '-60%' : 
                                    position === 'right' ? '60%' : '0%'
                                }) scale(${isCenter ? 1 : 0.7})`,
                                opacity: isCenter ? 1 : 0.6,
                                zIndex: isCenter ? 10 : 5,
                                cursor: !isCenter ? 'pointer' : 'default',
                                boxSizing: 'border-box',
                                backdropFilter: 'blur(8px)',
                                boxShadow: isCenter 
                                    ? '0 12px 40px rgba(0, 0, 0, 0.6), inset 0 1px 0 rgba(255, 255, 255, 0.1)'
                                    : '0 8px 24px rgba(0, 0, 0, 0.4)',
                            }}
                            onClick={() => !isCenter && goToSlide(index)}
                        >
                            {/* Item Icon */}
                            <img
                                src={item.icon}
                                alt={item.title}
                                style={{
                                    width: isCenter ? 'clamp(70px, 12vw, 90px)' : 'clamp(50px, 8vw, 60px)',
                                    height: isCenter ? 'clamp(70px, 12vw, 90px)' : 'clamp(50px, 8vw, 60px)',
                                    objectFit: 'contain',
                                    marginBottom: isCenter ? 'clamp(16px, 3vw, 20px)' : '16px',
                                    filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))',
                                    transition: 'all 0.3s ease',
                                }}
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />

                            {/* Item Title */}
                            <h3 style={{
                                fontSize: isCenter ? 'clamp(20px, 3vw, 24px)' : 'clamp(16px, 2.5vw, 18px)',
                                color: '#ff8c00',
                                marginBottom: isCenter ? 'clamp(12px, 2vw, 16px)' : '12px',
                                fontWeight: 'bold',
                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                letterSpacing: '1px',
                                lineHeight: '1.2',
                                transition: 'all 0.3s ease',
                            }}>
                                {item.title}
                            </h3>

                            {/* Item Description - Only show on center item */}
                            {isCenter && (
                                <p style={{
                                    fontSize: 'clamp(14px, 2.5vw, 16px)',
                                    lineHeight: '1.6',
                                    color: 'rgba(255, 255, 255, 0.85)',
                                    textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                    margin: '0',
                                    textAlign: 'center',
                                    padding: '0 4px',
                                    flex: '1',
                                    display: 'flex',
                                    alignItems: 'flex-start',
                                    justifyContent: 'center',
                                    flexDirection: 'column',
                                }}>
                                    <span style={{ textAlign: 'center', width: '100%' }}>
                                        {item.description}
                                    </span>
                                </p>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Navigation Arrows */}
            <button
                onClick={prevSlide}
                disabled={isAnimating}
                style={{
                    position: 'absolute',
                    left: 'clamp(10px, 2vw, 20px)',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 'clamp(40px, 8vw, 50px)',
                    height: 'clamp(40px, 8vw, 50px)',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    border: '2px solid rgba(255, 255, 255, 0.3)',
                    color: 'white',
                    fontSize: '20px',
                    cursor: isAnimating ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.3s ease',
                    backdropFilter: 'blur(8px)',
                    zIndex: 20,
                    opacity: isAnimating ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                    if (!isAnimating) {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)';
                    }
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                }}
            >
                ‹
            </button>

            <button
                onClick={nextSlide}
                disabled={isAnimating}
                style={{
                    position: 'absolute',
                    right: 'clamp(10px, 2vw, 20px)',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 'clamp(40px, 8vw, 50px)',
                    height: 'clamp(40px, 8vw, 50px)',
                    borderRadius: '50%',
                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                    border: '2px solid rgba(255, 255, 255, 0.3)',
                    color: 'white',
                    fontSize: '20px',
                    cursor: isAnimating ? 'default' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.3s ease',
                    backdropFilter: 'blur(8px)',
                    zIndex: 20,
                    opacity: isAnimating ? 0.5 : 1,
                }}
                onMouseEnter={(e) => {
                    if (!isAnimating) {
                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.2)';
                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.5)';
                    }
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                    e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                }}
            >
                ›
            </button>

            {/* Dots Indicator */}
            <div style={{
                position: 'absolute',
                bottom: '20px',
                left: '50%',
                transform: 'translateX(-50%)',
                display: 'flex',
                gap: '12px',
                zIndex: 20,
            }}>
                {carouselItems.map((_, index) => (
                    <button
                        key={index}
                        onClick={() => goToSlide(index)}
                        disabled={isAnimating}
                        style={{
                            width: '12px',
                            height: '12px',
                            borderRadius: '50%',
                            border: 'none',
                            backgroundColor: index === currentIndex 
                                ? '#ff8c00' 
                                : 'rgba(255, 255, 255, 0.4)',
                            cursor: isAnimating ? 'default' : 'pointer',
                            transition: 'all 0.3s ease',
                            opacity: isAnimating ? 0.5 : 1,
                        }}
                    />
                ))}
            </div>
        </div>
    );
};

export default ShipwreckCarousel;
