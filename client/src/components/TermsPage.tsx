import React from 'react';
import BlogHeader from '../common/BlogHeader';
import BlogFooter from '../blog/BlogFooter';

const TermsPage: React.FC = () => {
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
                    TERMS OF SERVICE
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
                        <strong>Note:</strong> Broth & Bullets is currently in early access development. These terms may be updated as we add new features and finalize our service offerings.
                    </p>
                </div>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        ACCEPTANCE OF TERMS
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        By accessing or using Broth & Bullets ("the Game"), you agree to be bound by these Terms of Service ("Terms"). If you do not agree to these Terms, you may not use the Game. These Terms constitute a legally binding agreement between you and Selo Oils LLC ("we," "us," or "Company").
                    </p>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        GAME ACCESS AND ACCOUNT
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        marginBottom: '20px',
                    }}>
                        To play Broth & Bullets, you must:
                    </p>
                    <ul style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        paddingLeft: '20px',
                    }}>
                        <li style={{ marginBottom: '10px' }}>Be at least 13 years old (or the minimum age required in your jurisdiction)</li>
                        <li style={{ marginBottom: '10px' }}>Create an account with accurate information</li>
                        <li style={{ marginBottom: '10px' }}>Maintain the security of your account credentials</li>
                        <li style={{ marginBottom: '10px' }}>Accept responsibility for all activities under your account</li>
                    </ul>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        ACCEPTABLE USE
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        marginBottom: '20px',
                    }}>
                        When using the Game, you agree NOT to:
                    </p>
                    <ul style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                        paddingLeft: '20px',
                    }}>
                        <li style={{ marginBottom: '10px' }}>Cheat, exploit bugs, or use unauthorized third-party software</li>
                        <li style={{ marginBottom: '10px' }}>Engage in harassment, hate speech, or abusive behavior</li>
                        <li style={{ marginBottom: '10px' }}>Attempt to gain unauthorized access to game systems or other players' accounts</li>
                        <li style={{ marginBottom: '10px' }}>Distribute malware or engage in any illegal activities</li>
                        <li style={{ marginBottom: '10px' }}>Impersonate other players or staff members</li>
                        <li style={{ marginBottom: '10px' }}>Sell, trade, or transfer your account to others</li>
                    </ul>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        EARLY ACCESS DISCLAIMER
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        Broth & Bullets is currently in early access development. The Game may contain bugs, incomplete features, or undergo significant changes. We provide the Game "as is" without warranty of any kind. Your progress, items, or account data may be affected by updates or technical issues.
                    </p>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        INTELLECTUAL PROPERTY
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        All content, features, and functionality of the Game are owned by Selo Oils LLC and are protected by copyright, trademark, and other intellectual property laws. You may not copy, modify, distribute, or create derivative works based on the Game without our express written permission.
                    </p>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        LIMITATION OF LIABILITY
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        To the maximum extent permitted by law, Selo Oils LLC shall not be liable for any indirect, incidental, special, consequential, or punitive damages arising out of or relating to your use of the Game. Our total liability shall not exceed the amount you paid for access to the Game, if any.
                    </p>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        TERMINATION
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        We may terminate or suspend your access to the Game immediately, without prior notice, for any reason, including if you breach these Terms. Upon termination, your right to use the Game ceases immediately. You may also terminate your account at any time by contacting us.
                    </p>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        CHANGES TO TERMS
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        We may update these Terms from time to time. We will notify you of any changes by posting the new Terms on this page and updating the "Last updated" date. Your continued use of the Game after such changes constitutes acceptance of the new Terms.
                    </p>
                </section>

                <section style={{ marginBottom: '40px' }}>
                    <h2 style={{
                        fontSize: '24px',
                        color: '#00aaff',
                        marginBottom: '20px',
                        fontWeight: 'bold',
                    }}>
                        GOVERNING LAW
                    </h2>
                    <p style={{
                        fontSize: '16px',
                        color: 'rgba(255, 255, 255, 0.8)',
                    }}>
                        These Terms shall be governed by and construed in accordance with the laws of the State of Connecticut, United States, without regard to its conflict of law principles.
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
                        If you have any questions about these Terms of Service, please contact us at:{' '}
                        <a href="mailto:legal@selooils.com" style={{
                            color: '#00aaff',
                            textDecoration: 'none',
                        }}>
                            legal@selooils.com
                        </a>
                    </p>
                </section>
            </div>

            <BlogFooter />
        </div>
    );
};

export default TermsPage; 