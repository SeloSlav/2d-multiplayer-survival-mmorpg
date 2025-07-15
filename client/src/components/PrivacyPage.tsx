import React from 'react';
import BlogHeader from '../common/BlogHeader';
import BlogFooter from '../blog/BlogFooter';

const PrivacyPage: React.FC = () => {
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
                    PRIVACY POLICY
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
                        <strong>Note:</strong> Broth & Bullets is currently in early access development. This privacy policy may be updated as we add new features and finalize our data handling practices.
                    </p>
                </div>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        INFORMATION WE COLLECT
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        marginBottom: '20px',
                    }}>
                        When you play Broth & Bullets, we collect the following information:
                    </p>
                    <ul style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        paddingLeft: '20px',
                    }}>
                        <li style={{ marginBottom: '10px' }}>Account information (username, email address) provided during registration</li>
                        <li style={{ marginBottom: '10px' }}>Game data (progress, achievements, in-game actions, chat messages)</li>
                        <li style={{ marginBottom: '10px' }}>Technical information (IP address, device information, browser type)</li>
                        <li style={{ marginBottom: '10px' }}>Usage analytics (gameplay statistics, feature usage, performance metrics)</li>
                    </ul>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        HOW WE USE YOUR INFORMATION
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        marginBottom: '20px',
                    }}>
                        We use your information to:
                    </p>
                    <ul style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        paddingLeft: '20px',
                    }}>
                        <li style={{ marginBottom: '10px' }}>Provide and maintain the game service</li>
                        <li style={{ marginBottom: '10px' }}>Enable multiplayer functionality and persistent world features</li>
                        <li style={{ marginBottom: '10px' }}>Improve gameplay experience and develop new features</li>
                        <li style={{ marginBottom: '10px' }}>Prevent cheating and ensure fair play</li>
                        <li style={{ marginBottom: '10px' }}>Communicate with you about game updates and important notices</li>
                    </ul>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        DATA SHARING AND DISCLOSURE
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        marginBottom: '20px',
                    }}>
                        We do not sell, rent, or trade your personal information to third parties. We may share information only in the following circumstances:
                    </p>
                    <ul style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        paddingLeft: '20px',
                    }}>
                        <li style={{ marginBottom: '10px' }}>With service providers who help us operate the game (hosting, analytics, customer support)</li>
                        <li style={{ marginBottom: '10px' }}>To comply with legal obligations or protect our rights</li>
                        <li style={{ marginBottom: '10px' }}>In connection with a business transfer or acquisition</li>
                        <li style={{ marginBottom: '10px' }}>With your consent for specific purposes</li>
                    </ul>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        DATA SECURITY
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        We implement appropriate technical and organizational security measures to protect your personal information against unauthorized access, alteration, disclosure, or destruction. However, no method of transmission over the internet or electronic storage is 100% secure.
                    </p>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        YOUR RIGHTS
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        marginBottom: '20px',
                    }}>
                        Depending on your location, you may have the following rights regarding your personal information:
                    </p>
                    <ul style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        paddingLeft: '20px',
                    }}>
                        <li style={{ marginBottom: '10px' }}>Access to your personal information</li>
                        <li style={{ marginBottom: '10px' }}>Correction of inaccurate information</li>
                        <li style={{ marginBottom: '10px' }}>Deletion of your personal information</li>
                        <li style={{ marginBottom: '10px' }}>Restriction of processing</li>
                        <li style={{ marginBottom: '10px' }}>Data portability</li>
                    </ul>
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
                        If you have any questions about this Privacy Policy or our data practices, please contact us at:{' '}
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

export default PrivacyPage; 