import React from 'react';
import BlogHeader from '../common/BlogHeader';
import BlogFooter from '../blog/BlogFooter';

const CookiesPage: React.FC = () => {
    return (
        <div style={{
            minHeight: '100vh',
            backgroundColor: '#0a0a0a',
            color: '#ffffff',
            fontFamily: "'Courier New', Consolas, Monaco, monospace",
            overflowX: 'hidden',
        }}>
            <BlogHeader />

            {/* Main Content */}
            <div style={{
                maxWidth: '800px',
                margin: '0 auto',
                padding: '140px 20px 60px 20px', // Add top padding to account for fixed header
                lineHeight: '1.6',
            }}>
                <h1 style={{
                    fontSize: '48px',
                    color: '#00aaff',
                    marginBottom: '20px',
                    textAlign: 'center',
                    fontWeight: 'bold',
                    textShadow: '2px 2px 4px rgba(0,0,0,0.8)',
                }}>
                    COOKIE DECLARATION
                </h1>

                <div style={{
                    fontSize: '14px',
                    color: 'rgba(255, 255, 255, 0.6)',
                    textAlign: 'center',
                    marginBottom: '60px',
                }}>
                    Last updated: January 2025
                </div>

                <div style={{
                    backgroundColor: 'rgba(0, 170, 255, 0.1)',
                    border: '1px solid rgba(0, 170, 255, 0.3)',
                    borderRadius: '8px',
                    padding: '20px',
                    marginBottom: '40px',
                }}>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.9)',
                        margin: 0,
                    }}>
                        <strong>Note:</strong> Broth & Bullets is currently in early access development. Our cookie usage may change as we add new features and integrate additional services.
                    </p>
                </div>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        WHAT ARE COOKIES?
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        Cookies are small text files that are placed on your device when you visit our website or use our game. They help us provide you with a better gaming experience by remembering your preferences and enabling essential functionality.
                    </p>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        HOW WE USE COOKIES
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        marginBottom: '20px',
                    }}>
                        We use cookies and similar technologies for the following purposes:
                    </p>
                    <ul style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        paddingLeft: '20px',
                    }}>
                        <li style={{ marginBottom: '10px' }}>Authentication and account management</li>
                        <li style={{ marginBottom: '10px' }}>Saving your game preferences and settings</li>
                        <li style={{ marginBottom: '10px' }}>Maintaining your login session</li>
                        <li style={{ marginBottom: '10px' }}>Analyzing website and game usage patterns</li>
                        <li style={{ marginBottom: '10px' }}>Improving performance and user experience</li>
                    </ul>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        TYPES OF COOKIES WE USE
                    </h2>
                    
                    <div style={{ marginBottom: '30px' }}>
                        <h3 style={{
                            fontSize: '18px',
                            color: '#00aaff',
                            marginBottom: '15px',
                            fontWeight: 'bold',
                        }}>
                            ESSENTIAL COOKIES
                        </h3>
                        <p style={{
                            fontSize: '16px',
                            color: 'rgba(255, 255, 255, 0.8)',
                        }}>
                            These cookies are necessary for the game to function properly. They enable core functionality such as authentication, account management, and game state persistence. These cookies cannot be disabled.
                        </p>
                    </div>

                    <div style={{ marginBottom: '30px' }}>
                        <h3 style={{
                            fontSize: '18px',
                            color: '#00aaff',
                            marginBottom: '15px',
                            fontWeight: 'bold',
                        }}>
                            PERFORMANCE COOKIES
                        </h3>
                        <p style={{
                            fontSize: '16px',
                            color: 'rgba(255, 255, 255, 0.8)',
                        }}>
                            These cookies help us understand how you interact with our game and website, allowing us to improve performance and user experience. They collect anonymous usage statistics and help us identify and fix issues.
                        </p>
                    </div>

                    <div style={{ marginBottom: '30px' }}>
                        <h3 style={{
                            fontSize: '18px',
                            color: '#00aaff',
                            marginBottom: '15px',
                            fontWeight: 'bold',
                        }}>
                            FUNCTIONAL COOKIES
                        </h3>
                        <p style={{
                            fontSize: '16px',
                            color: 'rgba(255, 255, 255, 0.8)',
                        }}>
                            These cookies remember your preferences and settings, such as language choices, display options, and other customizations to enhance your gaming experience.
                        </p>
                    </div>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        THIRD-PARTY COOKIES
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        marginBottom: '20px',
                    }}>
                        We may use third-party services that place cookies on your device. These may include:
                    </p>
                    <ul style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        paddingLeft: '20px',
                    }}>
                        <li style={{ marginBottom: '10px' }}>Authentication providers (for secure login)</li>
                        <li style={{ marginBottom: '10px' }}>Analytics services (for usage insights)</li>
                        <li style={{ marginBottom: '10px' }}>Content delivery networks (for improved performance)</li>
                        <li style={{ marginBottom: '10px' }}>Cloud hosting services (for game infrastructure)</li>
                    </ul>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        LOCAL STORAGE
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        In addition to cookies, we may use local storage technologies to save game data, preferences, and authentication tokens on your device. This data is used to provide a seamless gaming experience and maintain your session between visits.
                    </p>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        MANAGING COOKIES
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        marginBottom: '20px',
                    }}>
                        You can control cookies through your browser settings. However, please note that disabling certain cookies may affect the functionality of the game and your overall experience.
                    </p>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        Most browsers allow you to view, manage, and delete cookies. You can usually find these options in your browser's privacy or security settings. Keep in mind that clearing cookies will log you out of the game and reset your preferences.
                    </p>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        UPDATES TO THIS DECLARATION
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        We may update this Cookie Declaration from time to time to reflect changes in our practices or applicable laws. We will notify you of any significant changes by posting the updated declaration on this page and updating the "Last updated" date.
                    </p>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        CONTACT US
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        If you have any questions about our use of cookies or this Cookie Declaration, please contact us at:{' '}
                        <a href="mailto:privacy@selooils.com" style={{
                            color: '#00aaff',
                            textDecoration: 'none',
                        }}>
                            privacy@selooils.com
                        </a>
                    </p>
                </section>
            </div>

            <BlogFooter />
        </div>
    );
};

export default CookiesPage; 