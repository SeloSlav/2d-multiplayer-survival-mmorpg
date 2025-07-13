import React from 'react';
import { Link } from 'react-router-dom';

const BlogHeader: React.FC = () => {
    return (
        <header style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            width: '100%',
            zIndex: 1000,
            background: 'linear-gradient(135deg, rgba(0, 10, 20, 0.95) 0%, rgba(0, 20, 40, 0.98) 100%)',
            backdropFilter: 'blur(10px)',
            borderBottom: '1px solid rgba(0, 170, 255, 0.3)',
            boxShadow: '0 2px 10px rgba(0, 170, 255, 0.2)',
            padding: '15px 0',
            height: '80px',
            boxSizing: 'border-box',
        }}>
            <div style={{
                maxWidth: '1200px',
                margin: '0 auto',
                padding: '0 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                height: '100%',
            }}>
                {/* Logo */}
                <Link 
                    to="/blog" 
                    style={{
                        display: 'flex',
                        alignItems: 'center',
                        textDecoration: 'none',
                        transition: 'all 0.3s ease',
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.transform = 'scale(1.05)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.transform = 'scale(1)';
                    }}
                >
                    <img
                        src="/images/blog/logo.png"
                        alt="Broth & Bullets"
                        style={{
                            height: '50px',
                            width: 'auto',
                            filter: 'none',
                            boxShadow: 'none',
                            border: 'none',
                            outline: 'none',
                        }}
                    />
                </Link>

                {/* Right side buttons */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px',
                }}>
                    {/* Back to Blog Button */}
                    <Link
                        to="/blog"
                        style={{
                            display: 'inline-block',
                            background: 'linear-gradient(135deg, #2a2a2a 0%, #404040 100%)',
                            border: '2px solid #666666',
                            borderRadius: '8px',
                            color: '#ffffff',
                            padding: '12px 24px',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            letterSpacing: '1px',
                            textTransform: 'uppercase',
                            textDecoration: 'none',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 0 10px rgba(102, 102, 102, 0.3)',
                            fontFamily: "'Courier New', Consolas, Monaco, monospace",
                            minWidth: '120px',
                            textAlign: 'center',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, #404040 0%, #606060 100%)';
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 4px 20px rgba(102, 102, 102, 0.6)';
                            e.currentTarget.style.borderColor = '#888888';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, #2a2a2a 0%, #404040 100%)';
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 0 10px rgba(102, 102, 102, 0.3)';
                            e.currentTarget.style.borderColor = '#666666';
                        }}
                    >
                        Blog
                    </Link>

                    {/* Play Now Button */}
                    <Link
                        to="/"
                        style={{
                            display: 'inline-block',
                            background: 'linear-gradient(135deg, #003366 0%, #00aaff 100%)',
                            border: '2px solid #00aaff',
                            borderRadius: '8px',
                            color: '#ffffff',
                            padding: '12px 24px',
                            fontSize: '14px',
                            fontWeight: 'bold',
                            letterSpacing: '1px',
                            textTransform: 'uppercase',
                            textDecoration: 'none',
                            transition: 'all 0.3s ease',
                            boxShadow: '0 0 10px rgba(0, 170, 255, 0.3)',
                            fontFamily: "'Courier New', Consolas, Monaco, monospace",
                            minWidth: '120px',
                            textAlign: 'center',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, #0066aa 0%, #00ddff 100%)';
                            e.currentTarget.style.transform = 'translateY(-2px)';
                            e.currentTarget.style.boxShadow = '0 4px 20px rgba(0, 170, 255, 0.6)';
                            e.currentTarget.style.borderColor = '#00ddff';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, #003366 0%, #00aaff 100%)';
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 0 10px rgba(0, 170, 255, 0.3)';
                            e.currentTarget.style.borderColor = '#00aaff';
                        }}
                    >
                        Play Now
                    </Link>
                </div>
            </div>
        </header>
    );
};

export default BlogHeader; 