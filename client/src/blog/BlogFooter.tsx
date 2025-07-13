import React from 'react';
import { Link } from 'react-router-dom';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDiscord, faXTwitter, faGithub } from '@fortawesome/free-brands-svg-icons';

const BlogFooter: React.FC = () => {
    // Check if we're on mobile
    const isMobile = window.innerWidth <= 768;

    const scrollToSection = (sectionSelector: string) => {
        // For blog, we'll link back to the main game page for sections
        window.location.href = `/#${sectionSelector}`;
    };

    return (
        <footer style={{
            backgroundColor: 'rgba(0, 0, 0, 0.95)',
            backdropFilter: 'blur(20px)',
            borderTop: '1px solid rgba(0, 170, 255, 0.3)',
            padding: 'clamp(30px, 6vw, 60px) clamp(20px, 5vw, 40px) clamp(20px, 4vw, 40px) clamp(20px, 5vw, 40px)',
            position: 'relative',
            zIndex: 3,
            width: '100%',
            boxSizing: 'border-box',
            overflowX: 'hidden',
            marginTop: '60px',
        }}>
            {/* Decorative line at top */}
            <div style={{
                position: 'absolute',
                top: 0,
                left: '50%',
                transform: 'translateX(-50%)',
                width: '60%',
                height: '1px',
                background: 'linear-gradient(90deg, transparent 0%, rgba(0, 170, 255, 0.6) 50%, transparent 100%)',
            }} />

            {/* Decorative symbol at center top */}
            <div style={{
                position: 'absolute',
                top: '-8px',
                left: '50%',
                transform: 'translateX(-50%)',
                width: '16px',
                height: '16px',
                background: 'linear-gradient(135deg, #00aaff 0%, #0066cc 100%)',
                borderRadius: '50%',
                border: '2px solid rgba(0, 0, 0, 0.95)',
                boxShadow: '0 0 15px rgba(0, 170, 255, 0.5)',
            }} />

            {/* Footer Grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : 'repeat(4, 1fr)',
                gap: isMobile ? '40px' : '30px',
                maxWidth: '1200px',
                margin: '0 auto',
                alignItems: 'start',
            }}>
                {/* Company Info */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isMobile ? 'center' : 'flex-start',
                    textAlign: isMobile ? 'center' : 'left',
                }}>
                    <img
                        src="/images/blog/logo.png"
                        alt="Broth & Bullets Logo"
                        style={{
                            width: '160px',
                            height: 'auto',
                            marginBottom: '20px',
                            filter: 'none',
                            boxShadow: 'none',
                            border: 'none',
                            outline: 'none',
                        }}
                    />
                    <p style={{
                        fontSize: '13px',
                        color: 'rgba(255, 255, 255, 0.7)',
                        lineHeight: '1.6',
                        margin: '0',
                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                        fontFamily: "'Courier New', Consolas, Monaco, monospace",
                    }}>
                        Broth & Bullets is developed by{' '}
                        <a
                            href="https://seloolive.com/products/authentic-croatian-olive-oil?variant=40790542549035#reviews"
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                                color: '#00aaff',
                                textDecoration: 'none',
                                transition: 'color 0.2s ease',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.color = '#00ddff';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.color = '#00aaff';
                            }}
                        >
                            Selo Oils LLC
                        </a>
                    </p>
                    <p style={{
                        fontSize: '12px',
                        color: 'rgba(255, 255, 255, 0.5)',
                        margin: '10px 0 0 0',
                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                        fontFamily: "'Courier New', Consolas, Monaco, monospace",
                    }}>
                        © 2025 Selo Oils LLC
                    </p>
                </div>

                {/* Game Links */}
                <div style={{
                    textAlign: isMobile ? 'center' : 'left',
                }}>
                    <h4 style={{
                        fontSize: '14px',
                        color: '#00aaff',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '2px',
                        marginBottom: '20px',
                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                        fontFamily: "'Courier New', Consolas, Monaco, monospace",
                    }}>
                        GAME
                    </h4>
                    <ul style={{
                        listStyle: 'none',
                        padding: 0,
                        margin: 0,
                    }}>
                        {[
                            { label: 'ABOUT', action: '/#about' },
                            { label: 'BABUSHKA\'S TOOLS', action: '/#tools' },
                            { label: 'FEATURES', action: '/#features' },
                            { label: 'FAQ', action: '/#faq' },
                            { label: 'LORE', action: 'https://www.babushkabook.com/', external: true },
                            { label: 'BLOG', action: '/blog', internal: true },
                            { label: 'CONTACT', action: 'mailto:martin@selooils.com', external: true },
                        ].map((link) => (
                            <li key={link.label} style={{ marginBottom: '12px' }}>
                                {link.internal ? (
                                    <Link
                                        to={link.action}
                                        style={{
                                            color: 'rgba(255, 255, 255, 0.7)',
                                            textDecoration: 'none',
                                            fontSize: '13px',
                                            transition: 'color 0.2s ease',
                                            fontFamily: "'Courier New', Consolas, Monaco, monospace",
                                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.color = '#00aaff';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                                        }}
                                    >
                                        {link.label}
                                    </Link>
                                ) : (
                                    <a
                                        href={link.action}
                                        target={link.external ? "_blank" : undefined}
                                        rel={link.external ? "noopener noreferrer" : undefined}
                                        onClick={link.external ? undefined : (e) => {
                                            e.preventDefault();
                                            window.location.href = link.action;
                                        }}
                                        style={{
                                            color: 'rgba(255, 255, 255, 0.7)',
                                            textDecoration: 'none',
                                            fontSize: '13px',
                                            transition: 'color 0.2s ease',
                                            fontFamily: "'Courier New', Consolas, Monaco, monospace",
                                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.color = '#00aaff';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                                        }}
                                    >
                                        {link.label}
                                    </a>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Legal Links */}
                <div style={{
                    textAlign: isMobile ? 'center' : 'left',
                }}>
                    <h4 style={{
                        fontSize: '14px',
                        color: '#00aaff',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '2px',
                        marginBottom: '20px',
                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                        fontFamily: "'Courier New', Consolas, Monaco, monospace",
                    }}>
                        LEGAL
                    </h4>
                    <ul style={{
                        listStyle: 'none',
                        padding: 0,
                        margin: 0,
                    }}>
                        {['PRIVACY POLICY', 'TERMS OF SERVICE', 'COOKIE DECLARATION'].map((link) => (
                            <li key={link} style={{ marginBottom: '12px' }}>
                                <a
                                    href="#"
                                    onClick={(e) => e.preventDefault()}
                                    style={{
                                        color: 'rgba(255, 255, 255, 0.7)',
                                        textDecoration: 'none',
                                        fontSize: '13px',
                                        transition: 'color 0.2s ease',
                                        fontFamily: "'Courier New', Consolas, Monaco, monospace",
                                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.color = '#00aaff';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                                    }}
                                >
                                    {link}
                                </a>
                            </li>
                        ))}
                    </ul>
                </div>

                {/* Social Links */}
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: isMobile ? 'center' : 'flex-end',
                }}>
                    <h4 style={{
                        fontSize: '14px',
                        color: '#00aaff',
                        fontWeight: '600',
                        textTransform: 'uppercase',
                        letterSpacing: '2px',
                        marginBottom: '20px',
                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                        fontFamily: "'Courier New', Consolas, Monaco, monospace",
                        textAlign: isMobile ? 'center' : 'right',
                    }}>
                        CONNECT
                    </h4>
                    {/* Social Media Icons */}
                    <div style={{
                        display: 'flex',
                        gap: '15px',
                        marginBottom: '30px',
                    }}>
                        {[
                            { name: 'Discord', icon: faDiscord, href: 'https://discord.com/channels/1037340874172014652/1381583490646147093' },
                            { name: 'X (Twitter)', icon: faXTwitter, href: 'https://x.com/seloslav' },
                            { name: 'GitHub', icon: faGithub, href: 'https://github.com/SeloSlav/vibe-coding-starter-pack-2d-multiplayer-survival' },
                        ].map((social) => (
                            <a
                                key={social.name}
                                href={social.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                title={social.name}
                                style={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '50%',
                                    border: '1px solid rgba(0, 170, 255, 0.4)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    fontSize: '16px',
                                    textDecoration: 'none',
                                    transition: 'all 0.3s ease',
                                    backgroundColor: 'rgba(0, 170, 255, 0.1)',
                                    color: 'rgba(255, 255, 255, 0.7)',
                                    boxShadow: '0 0 10px rgba(0, 170, 255, 0.2)',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.borderColor = '#00aaff';
                                    e.currentTarget.style.backgroundColor = 'rgba(0, 170, 255, 0.2)';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.color = '#00aaff';
                                    e.currentTarget.style.boxShadow = '0 0 20px rgba(0, 170, 255, 0.5)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.borderColor = 'rgba(0, 170, 255, 0.4)';
                                    e.currentTarget.style.backgroundColor = 'rgba(0, 170, 255, 0.1)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                                    e.currentTarget.style.boxShadow = '0 0 10px rgba(0, 170, 255, 0.2)';
                                }}
                            >
                                <FontAwesomeIcon icon={social.icon} />
                            </a>
                        ))}
                    </div>

                    {/* Back to Top Button */}
                    <button
                        onClick={() => {
                            window.scrollTo({
                                top: 0,
                                behavior: 'smooth'
                            });
                        }}
                        style={{
                            width: '50px',
                            height: '50px',
                            borderRadius: '50%',
                            border: '2px solid rgba(0, 170, 255, 0.6)',
                            background: 'linear-gradient(135deg, rgba(0, 170, 255, 0.2) 0%, rgba(0, 100, 200, 0.4) 100%)',
                            color: '#00aaff',
                            fontSize: '18px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                            boxShadow: '0 4px 15px rgba(0,0,0,0.3), 0 0 10px rgba(0,170,255,0.4)',
                            fontFamily: "'Courier New', Consolas, Monaco, monospace",
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(0, 170, 255, 0.3)';
                            e.currentTarget.style.borderColor = 'rgba(0, 170, 255, 0.9)';
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4), 0 0 15px rgba(0,170,255,0.6)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'linear-gradient(135deg, rgba(0, 170, 255, 0.2) 0%, rgba(0, 100, 200, 0.4) 100%)';
                            e.currentTarget.style.borderColor = 'rgba(0, 170, 255, 0.6)';
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3), 0 0 10px rgba(0,170,255,0.4)';
                        }}
                        title="Back to Top"
                    >
                        ↑
                    </button>
                </div>
            </div>
        </footer>
    );
};

export default BlogFooter; 