/**
 * LoginScreen.tsx
 * 
 * Displays the initial welcome/login screen.
 * Handles:
 *  - Displaying game title and logo.
 *  - Triggering OpenAuth OIDC login flow.
 *  - Input field for username (for NEW players).
 *  - Displaying existing username for returning players.
 *  - Displaying loading states and errors.
 *  - Handling logout.
 */

import React, { useRef, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
// Import the Player type from generated bindings
import { Player } from '../generated/types'; // Adjusted path
// Import FontAwesome
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDiscord, faXTwitter, faGithub } from '@fortawesome/free-brands-svg-icons';
import { faBars, faTimes, faChevronDown, faChevronRight } from '@fortawesome/free-solid-svg-icons';
import loginBackground from '../assets/ui/login_background.png';
import logo from '../assets/ui/logo_alt.png';
import ShipwreckCarousel from './ShipwreckCarousel';
import GameplayFeaturesCarousel from './GameplayFeaturesCarousel';
// @ts-ignore - importing JavaScript module
import { blogPosts } from '../blog/data/blogPosts';

// Style Constants (Consider moving to a shared file)
const UI_BG_COLOR = 'rgba(40, 40, 60, 0.85)';
const UI_BORDER_COLOR = '#a0a0c0';
const UI_SHADOW = '2px 2px 0px rgba(0,0,0,0.5)';
const UI_FONT_FAMILY = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif";
const UI_BUTTON_COLOR = '#777';
const UI_BUTTON_DISABLED_COLOR = '#555';
const UI_PAGE_BG_COLOR = '#1a1a2e';

// Mobile Navigation Menu Component
interface MobileNavMenuProps {
    navItems: Array<{ label: string; selector: string }>;
    onNavigate: (selector: string) => void;
    onPlayClick: () => void;
    /** When provided, shows signed-in email and logout at top of menu */
    userEmail?: string | null;
    onLogout?: () => void;
}

const MobileNavMenu: React.FC<MobileNavMenuProps> = ({ navItems, onNavigate, onPlayClick, userEmail, onLogout }) => {
    const [isOpen, setIsOpen] = useState(false);

    const handleNavClick = (selector: string) => {
        setIsOpen(false);
        onNavigate(selector);
    };

    const handlePlayClick = () => {
        setIsOpen(false);
        onPlayClick();
    };

    return (
        <>
            {/* Hamburger Button */}
            <button
                onClick={() => setIsOpen(!isOpen)}
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.9)',
                    fontSize: '24px',
                    cursor: 'pointer',
                    padding: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'all 0.2s ease',
                    zIndex: 1001,
                }}
                onMouseEnter={(e) => {
                    e.currentTarget.style.color = '#ff8c00';
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.9)';
                }}
            >
                <FontAwesomeIcon icon={isOpen ? faTimes : faBars} />
            </button>

            {/* Mobile Menu Overlay */}
            {isOpen && (
                <>
                    {/* Backdrop */}
                    <div
                        onClick={() => setIsOpen(false)}
                        style={{
                            position: 'fixed',
                            top: 0,
                            left: 0,
                            right: 0,
                            bottom: 0,
                            backgroundColor: 'rgba(0, 0, 0, 0.8)',
                            zIndex: 1000,
                            animation: 'fadeIn 0.2s ease-out',
                        }}
                    />

                    {/* Menu Panel */}
                    <div
                        style={{
                            position: 'fixed',
                            top: '70px',
                            right: 0,
                            width: '280px',
                            maxWidth: '85vw',
                            height: 'calc(100vh - 70px)',
                            backgroundColor: 'rgba(0, 0, 0, 0.98)',
                            backdropFilter: 'blur(20px)',
                            borderLeft: '2px solid rgba(255, 140, 0, 0.3)',
                            boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.5)',
                            zIndex: 1001,
                            display: 'flex',
                            flexDirection: 'column',
                            padding: '20px 0',
                            animation: 'slideInRight 0.3s ease-out',
                            overflowY: 'auto',
                        }}
                    >
                        {/* Account section - when signed in */}
                        {userEmail && onLogout && (
                            <div style={{
                                padding: '0 24px 16px',
                                marginBottom: '12px',
                                borderBottom: '1px solid rgba(255, 140, 0, 0.2)',
                            }}>
                                <p style={{
                                    fontSize: '11px',
                                    color: 'rgba(255, 255, 255, 0.5)',
                                    margin: '0 0 4px 0',
                                    textTransform: 'uppercase',
                                    letterSpacing: '1px',
                                }}>
                                    Signed in as
                                </p>
                                <p style={{
                                    fontSize: '13px',
                                    color: 'rgba(0, 212, 255, 0.95)',
                                    margin: '0 0 12px 0',
                                    wordBreak: 'break-all',
                                    fontFamily: 'monospace',
                                }}>
                                    {userEmail}
                                </p>
                                <button
                                    type="button"
                                    onClick={() => { setIsOpen(false); onLogout(); }}
                                    style={{
                                        width: '100%',
                                        padding: '10px 16px',
                                        background: 'rgba(255, 0, 100, 0.15)',
                                        border: '1px solid rgba(255, 0, 100, 0.4)',
                                        borderRadius: '6px',
                                        color: 'rgba(255, 150, 180, 0.95)',
                                        fontSize: '12px',
                                        fontFamily: 'monospace',
                                        cursor: 'pointer',
                                        textTransform: 'uppercase',
                                        letterSpacing: '1px',
                                        transition: 'all 0.2s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.background = 'rgba(255, 0, 100, 0.25)';
                                        e.currentTarget.style.borderColor = 'rgba(255, 0, 100, 0.6)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.background = 'rgba(255, 0, 100, 0.15)';
                                        e.currentTarget.style.borderColor = 'rgba(255, 0, 100, 0.4)';
                                    }}
                                >
                                    Log out
                                </button>
                            </div>
                        )}

                        {navItems.map((item) => (
                            <button
                                key={item.label}
                                onClick={() => handleNavClick(item.selector)}
                                style={{
                                    background: 'none',
                                    border: 'none',
                                    color: 'rgba(255, 255, 255, 0.8)',
                                    fontSize: '16px',
                                    fontWeight: '600',
                                    cursor: 'pointer',
                                    padding: '16px 24px',
                                    textAlign: 'left',
                                    transition: 'all 0.2s ease',
                                    textTransform: 'uppercase',
                                    letterSpacing: '1px',
                                    borderLeft: '3px solid transparent',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.color = '#ff8c00';
                                    e.currentTarget.style.backgroundColor = 'rgba(255, 140, 0, 0.1)';
                                    e.currentTarget.style.borderLeftColor = '#ff8c00';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
                                    e.currentTarget.style.backgroundColor = 'transparent';
                                    e.currentTarget.style.borderLeftColor = 'transparent';
                                }}
                            >
                                {item.label}
                            </button>
                        ))}

                        {/* PLAY Button in Menu */}
                        <button
                            onClick={handlePlayClick}
                            style={{
                                backgroundColor: '#ff8c00',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                padding: '16px 24px',
                                fontSize: '16px',
                                fontWeight: 'bold',
                                cursor: 'pointer',
                                textTransform: 'uppercase',
                                letterSpacing: '1px',
                                boxShadow: '0 4px 12px rgba(255, 140, 0, 0.3)',
                                transition: 'all 0.2s ease',
                                margin: '20px 24px 0',
                            }}
                            onMouseEnter={(e) => {
                                e.currentTarget.style.backgroundColor = '#ff9d1a';
                                e.currentTarget.style.transform = 'translateY(-2px)';
                                e.currentTarget.style.boxShadow = '0 6px 16px rgba(255, 140, 0, 0.4)';
                            }}
                            onMouseLeave={(e) => {
                                e.currentTarget.style.backgroundColor = '#ff8c00';
                                e.currentTarget.style.transform = 'translateY(0)';
                                e.currentTarget.style.boxShadow = '0 4px 12px rgba(255, 140, 0, 0.3)';
                            }}
                        >
                            PLAY
                        </button>
                    </div>
                </>
            )}
        </>
    );
};

interface LoginScreenProps {
    // Removed username/setUsername props
    handleJoinGame: (usernameToRegister: string | null) => Promise<void>; // Accepts null for existing players, returns Promise to handle errors
    loggedInPlayer: Player | null; // Player data from SpacetimeDB if exists
    connectionError?: string | null; // SpacetimeDB connection error from GameConnectionContext
    storedUsername?: string | null; // Username from localStorage for connection error fallback
    isSpacetimeConnected?: boolean; // Whether SpacetimeDB is connected (used to hide username for connection issues)
    isSpacetimeReady?: boolean; // Whether SpacetimeDB is fully ready (connection + identity established)
    retryConnection?: () => void; // Function to retry the SpacetimeDB connection
    onlinePlayerCount?: number; // Live count of connected human players
    maxPlayerCount?: number; // Server capacity (e.g. 50)
}

const LoginScreen: React.FC<LoginScreenProps> = ({
    handleJoinGame,
    loggedInPlayer,
    connectionError,
    storedUsername,
    isSpacetimeConnected = true, // Default to true for backwards compatibility
    isSpacetimeReady = true, // Default to true for backwards compatibility
    retryConnection,
    onlinePlayerCount,
    maxPlayerCount,
}) => {
    // Get OpenAuth state and functions
    const {
        userProfile, // Contains { userId } after successful login 
        isAuthenticated,
        isLoading: authIsLoading,
        authError,
        loginRedirect,
        logout
    } = useAuth();

    // React Router navigation hook
    const navigate = useNavigate();

    // Local state for the username input field (only used for new players)
    const [inputUsername, setInputUsername] = useState<string>('');
    const [localError, setLocalError] = useState<string | null>(null);

    // Debug logging for new users (enable when debugging)
    // React.useEffect(() => {
    //     if (isAuthenticated && !loggedInPlayer && !storedUsername) {
    //         console.log(`[LoginScreen DEBUG] New user state - isSpacetimeReady: ${isSpacetimeReady}, isSpacetimeConnected: ${isSpacetimeConnected}, connectionError: ${connectionError}`);
    //     }
    // }, [isAuthenticated, loggedInPlayer, storedUsername, isSpacetimeReady, isSpacetimeConnected, connectionError]);
    const [isMobile, setIsMobile] = useState<boolean>(false);
    const [showBackToTop, setShowBackToTop] = useState<boolean>(false);
    const [showStickyNav, setShowStickyNav] = useState<boolean>(false);
    const [backgroundLoaded, setBackgroundLoaded] = useState<boolean>(false);
    const [logoLoaded, setLogoLoaded] = useState<boolean>(false);

    // --- Scroll-based Auth Header Visibility ---
    const [showAuthHeader, setShowAuthHeader] = useState<boolean>(true);
    const lastScrollY = useRef<number>(0);

    // Ref for username input focus
    const usernameInputRef = useRef<HTMLInputElement>(null);

    // Gleam animation hook for "Learn More" button
    const [isGleaming, setIsGleaming] = useState(false);
    const [showSystemRequirements, setShowSystemRequirements] = useState(false);
    const [expandedFaqIndex, setExpandedFaqIndex] = useState<number | null>(null);
    useEffect(() => {
        const interval = 3200;
        const duration = 600;
        const gleamTimeouts: NodeJS.Timeout[] = [];
        let mounted = true;

        function triggerGleam() {
            if (!mounted) return;
            setIsGleaming(true);
            gleamTimeouts.push(setTimeout(() => {
                if (mounted) setIsGleaming(false);
            }, duration));
        }

        const mainInterval = setInterval(triggerGleam, interval);
        // Initial gleam after 700ms
        gleamTimeouts.push(setTimeout(triggerGleam, 700));

        return () => {
            mounted = false;
            clearInterval(mainInterval);
            gleamTimeouts.forEach(clearTimeout);
        };
    }, []);

    // Check for mobile screen size
    useEffect(() => {
        const checkIsMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };

        checkIsMobile(); // Check on mount
        window.addEventListener('resize', checkIsMobile);
        return () => window.removeEventListener('resize', checkIsMobile);
    }, []);

    // Check scroll position for back to top button, sticky nav, and auth header
    useEffect(() => {
        const handleScroll = () => {
            const scrollTop = window.scrollY || document.documentElement.scrollTop;
            const currentScrollY = window.scrollY;

            setShowBackToTop(scrollTop > 300); // Show after scrolling 300px
            setShowStickyNav(scrollTop > window.innerHeight * 0.8); // Show after scrolling past 80% of viewport height

            // Auth header visibility logic
            if (currentScrollY < 50) {
                setShowAuthHeader(true);
            }
            // Hide header when scrolling down
            else if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
                setShowAuthHeader(false);
            }
            // Show header when scrolling up
            else if (currentScrollY < lastScrollY.current) {
                setShowAuthHeader(true);
            }

            lastScrollY.current = currentScrollY;
        };

        window.addEventListener('scroll', handleScroll, { passive: true });
        return () => window.removeEventListener('scroll', handleScroll);
    }, []);

    // Aggressive image preloading and loading detection
    useEffect(() => {
        // Preload background image with loading detection
        const backgroundImg = new Image();
        backgroundImg.onload = () => setBackgroundLoaded(true);
        backgroundImg.src = loginBackground;

        // Preload logo with loading detection
        const logoImg = new Image();
        logoImg.onload = () => setLogoLoaded(true);
        logoImg.src = logo;

        // Add preload hints to DOM for additional browser optimization
        const preloadBackground = document.createElement('link');
        preloadBackground.rel = 'preload';
        preloadBackground.href = loginBackground;
        preloadBackground.as = 'image';
        preloadBackground.fetchPriority = 'high';
        document.head.appendChild(preloadBackground);

        const preloadLogo = document.createElement('link');
        preloadLogo.rel = 'preload';
        preloadLogo.href = logo;
        preloadLogo.as = 'image';
        preloadLogo.fetchPriority = 'high';
        document.head.appendChild(preloadLogo);

        // Cleanup
        return () => {
            try {
                document.head.removeChild(preloadBackground);
                document.head.removeChild(preloadLogo);
            } catch (e) {
                // Elements might already be removed
            }
        };
    }, []);

    // Autofocus username field if authenticated AND it's a new player
    useEffect(() => {
        if (isAuthenticated && !loggedInPlayer) {
            usernameInputRef.current?.focus();
        }
    }, [isAuthenticated, loggedInPlayer]);

    // Smooth scroll function with offset for sticky nav
    const smoothScrollTo = (elementSelector: string) => {
        const element = document.querySelector(elementSelector);
        if (element) {
            const yOffset = -100; // Offset to account for sticky nav (70px) + extra padding (30px)
            const elementPosition = element.getBoundingClientRect().top;
            const offsetPosition = elementPosition + window.pageYOffset + yOffset;

            window.scrollTo({
                top: offsetPosition,
                behavior: 'smooth'
            });
        }
    };

    // Scroll to top function
    const scrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // Validation: only needed for new players entering a username
    const validateNewUsername = (): boolean => {
        if (!inputUsername.trim()) {
            setLocalError('Username is required to join the game');
            return false;
        }
        // Add other validation rules if needed (length, characters, etc.)
        setLocalError(null);
        return true;
    };

    // Handle button click: Trigger OpenAuth login or join game
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setLocalError(null); // Clear previous local errors

        if (!isAuthenticated) {
            // If not authenticated, start the OpenAuth login flow
            await loginRedirect();
        } else {
            // If authenticated, check if it's a new or existing player

            // CRITICAL CHECK: If authenticated but an authError exists, do not proceed.
            // This typically means a token was rejected, and invalidateCurrentToken should have
            // set isAuthenticated to false. If not, this is a safeguard.
            if (authError) {
                console.warn("[LoginScreen] Attempted to join game while authError is present. Aborting. Error:", authError);
                // The authError is already displayed. The user should likely re-authenticate.
                // Disabling the button (see below) also helps prevent this.
                return;
            }

            try {
                if (loggedInPlayer) {
                    // Existing player with loaded player data: Join directly
                    await handleJoinGame(null);
                } else if (storedUsername) {
                    // Existing player reconnecting with stored username: Join directly
                    await handleJoinGame(null);
                } else if (inputUsername.trim()) {
                    // New player with entered username: Validate and join
                    if (validateNewUsername()) {
                        await handleJoinGame(inputUsername);
                    }
                } else {
                    // No player data and no username entered
                    // Only show validation error if username input is actually visible
                    const shouldShowUsernameInput = !authError && !connectionError && !localError && isSpacetimeConnected && !loggedInPlayer && !storedUsername;
                    if (shouldShowUsernameInput) {
                        setLocalError('Username is required to join the game');
                    } else {
                        // Fallback: try to join anyway (might be a returning player with slow loading)
                        await handleJoinGame(null);
                    }
                }
            } catch (error) {
                // Handle server-side errors (like username already taken)
                const errorMessage = error instanceof Error ? error.message : String(error);
                setLocalError(errorMessage);
            }
        }
    };

    // Handle Enter key press in the input field (only applicable for new players)
    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !authIsLoading && isAuthenticated && !loggedInPlayer) {
            handleSubmit(event as unknown as React.FormEvent);
        }
    };

    // Override global App.css scroll restrictions for login screen
    React.useEffect(() => {
        // Store original styles
        const originalBodyOverflow = document.body.style.overflow;
        const originalBodyOverflowX = document.body.style.overflowX;
        const originalBodyOverflowY = document.body.style.overflowY;
        const originalBodyHeight = document.body.style.height;
        const originalHtmlOverflow = document.documentElement.style.overflow;
        const originalHtmlOverflowX = document.documentElement.style.overflowX;
        const originalHtmlOverflowY = document.documentElement.style.overflowY;

        // Find and override .App container styles
        const appElement = document.querySelector('.App') as HTMLElement;
        const originalAppOverflow = appElement?.style.overflow;
        const originalAppOverflowX = appElement?.style.overflowX;
        const originalAppOverflowY = appElement?.style.overflowY;
        const originalAppHeight = appElement?.style.height;

        // COMPLETELY DISABLE horizontal scrolling at all levels
        document.body.style.overflowX = 'hidden';
        document.body.style.overflowY = 'auto';
        document.body.style.height = 'auto';
        document.documentElement.style.overflowX = 'hidden';
        document.documentElement.style.overflowY = 'auto';

        // Apply to App container as well
        if (appElement) {
            appElement.style.overflowX = 'hidden';
            appElement.style.overflowY = 'auto';
            appElement.style.height = 'auto';
        }

        return () => {
            // Restore original styles when component unmounts
            document.body.style.overflow = originalBodyOverflow;
            document.body.style.overflowX = originalBodyOverflowX;
            document.body.style.overflowY = originalBodyOverflowY;
            document.body.style.height = originalBodyHeight;
            document.documentElement.style.overflow = originalHtmlOverflow;
            document.documentElement.style.overflowX = originalHtmlOverflowX;
            document.documentElement.style.overflowY = originalHtmlOverflowY;

            if (appElement) {
                appElement.style.overflow = originalAppOverflow || '';
                appElement.style.overflowX = originalAppOverflowX || '';
                appElement.style.overflowY = originalAppOverflowY || '';
                appElement.style.height = originalAppHeight || '';
            }
        };
    }, []);

    return (
        <>
            {/* Fixed Header with Email and Logout - Desktop only; on mobile we show it below JOIN GAME */}
            {isAuthenticated && userProfile && !isMobile && (
                <div
                    className="fixed-auth-header"
                    style={{
                        position: 'fixed',
                        top: 0,
                        right: 0,
                        zIndex: 9999,
                        padding: '12px 20px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '16px',
                        background: 'linear-gradient(135deg, rgba(0, 0, 0, 0.85) 0%, rgba(20, 20, 30, 0.9) 100%)',
                        backdropFilter: 'blur(10px)',
                        borderBottomLeftRadius: '8px',
                        borderLeft: '1px solid rgba(0, 255, 255, 0.3)',
                        borderBottom: '1px solid rgba(0, 255, 255, 0.3)',
                        boxShadow: '0 4px 20px rgba(0, 255, 255, 0.15)',
                        transform: showAuthHeader ? 'translateY(0)' : 'translateY(-100%)',
                        transition: 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                        pointerEvents: showAuthHeader ? 'auto' : 'none',
                    }}
                >
                    <span
                        style={{
                            color: 'rgba(0, 255, 255, 0.9)',
                            fontSize: '14px',
                            fontFamily: 'monospace',
                            textShadow: '0 0 10px rgba(0, 255, 255, 0.5)',
                        }}
                    >
                        {userProfile.email || 'User'}
                    </span>
                    <button
                        onClick={logout}
                        style={{
                            padding: '6px 16px',
                            background: 'linear-gradient(135deg, rgba(255, 0, 100, 0.2) 0%, rgba(200, 0, 80, 0.3) 100%)',
                            border: '1px solid rgba(255, 0, 100, 0.5)',
                            borderRadius: '4px',
                            color: 'rgba(255, 100, 150, 0.95)',
                            fontSize: '13px',
                            fontFamily: 'monospace',
                            cursor: 'pointer',
                            transition: 'all 0.2s ease',
                            textShadow: '0 0 8px rgba(255, 0, 100, 0.4)',
                            boxShadow: '0 2px 10px rgba(255, 0, 100, 0.2)',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 0, 100, 0.4) 0%, rgba(200, 0, 80, 0.5) 100%)';
                            e.currentTarget.style.borderColor = 'rgba(255, 0, 100, 0.8)';
                            e.currentTarget.style.boxShadow = '0 4px 15px rgba(255, 0, 100, 0.4)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.background = 'linear-gradient(135deg, rgba(255, 0, 100, 0.2) 0%, rgba(200, 0, 80, 0.3) 100%)';
                            e.currentTarget.style.borderColor = 'rgba(255, 0, 100, 0.5)';
                            e.currentTarget.style.boxShadow = '0 2px 10px rgba(255, 0, 100, 0.2)';
                        }}
                    >
                        LOG OUT
                    </button>
                </div>
            )}

            {/* Add CSS animations */}
            <style>{`
                @keyframes pulse {
                    0% { opacity: 0.4; }
                    100% { opacity: 0.8; }
                }
                @keyframes spin {
                    0% { transform: rotate(0deg); }
                    100% { transform: rotate(360deg); }
                }
                @keyframes slideDown {
                    from {
                        transform: translateY(-100%);
                        opacity: 0;
                    }
                    to {
                        transform: translateY(0);
                        opacity: 1;
                    }
                }
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes slideInRight {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `}</style>

            {/* Sticky Navigation Bar - Always visible on mobile, scroll-triggered on desktop */}
            {(isMobile || showStickyNav) && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    right: 0,
                    height: '70px',
                    backgroundColor: 'rgba(0, 0, 0, 0.95)',
                    backdropFilter: 'blur(10px)',
                    borderBottom: '2px solid rgba(255, 140, 0, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '0 clamp(20px, 5vw, 60px)',
                    zIndex: 1000,
                    boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)',
                    animation: 'slideDown 0.3s ease-out',
                }}>
                    {/* Logo */}
                    <img
                        src={logo}
                        alt="Broth & Bullets"
                        onClick={scrollToTop}
                        style={{
                            height: '50px',
                            cursor: 'pointer',
                            transition: 'transform 0.2s ease',
                        }}
                        onMouseEnter={(e) => e.currentTarget.style.transform = 'scale(1.05)'}
                        onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
                    />

                    {/* Navigation Links */}
                    {isMobile ? (
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                        }}>
                            {/* Play Now Button - Only show after scrolling past the fold */}
                            {showStickyNav && (
                                <button
                                    onClick={scrollToTop}
                                    style={{
                                        backgroundColor: '#ff8c00',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        padding: '8px 16px',
                                        fontSize: '13px',
                                        fontWeight: 'bold',
                                        cursor: 'pointer',
                                        textTransform: 'uppercase',
                                        letterSpacing: '1px',
                                        boxShadow: '0 4px 12px rgba(255, 140, 0, 0.3)',
                                        transition: 'all 0.2s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = '#ff9d1a';
                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                        e.currentTarget.style.boxShadow = '0 6px 16px rgba(255, 140, 0, 0.4)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = '#ff8c00';
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.boxShadow = '0 4px 12px rgba(255, 140, 0, 0.3)';
                                    }}
                                >
                                    PLAY
                                </button>
                            )}
                            <MobileNavMenu
                                navItems={[
                                    { label: 'ABOUT', selector: '[data-about-section]' },
                                    { label: 'LOADOUT', selector: '[data-tools-section]' },
                                    { label: 'FEATURES', selector: '[data-features-section]' },
                                    { label: 'BLOG', selector: '[data-blog-section]' },
                                    { label: 'FAQ', selector: '[data-faq-section]' },
                                ]}
                                onNavigate={smoothScrollTo}
                                onPlayClick={scrollToTop}
                                userEmail={isAuthenticated && userProfile ? (userProfile.email || null) : null}
                                onLogout={isAuthenticated ? logout : undefined}
                            />
                        </div>
                    ) : (
                        <nav style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '30px',
                            fontSize: '14px',
                        }}>
                            {[
                                { label: 'ABOUT', selector: '[data-about-section]' },
                                { label: 'LOADOUT', selector: '[data-tools-section]' },
                                { label: 'FEATURES', selector: '[data-features-section]' },
                                { label: 'BLOG', selector: '[data-blog-section]' },
                                { label: 'FAQ', selector: '[data-faq-section]' },
                            ].map((item) => (
                                <button
                                    key={item.label}
                                    onClick={() => smoothScrollTo(item.selector)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        color: 'rgba(255, 255, 255, 0.8)',
                                        fontSize: 'inherit',
                                        fontWeight: '600',
                                        cursor: 'pointer',
                                        padding: '8px 12px',
                                        transition: 'all 0.2s ease',
                                        textTransform: 'uppercase',
                                        letterSpacing: '1px',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.color = '#ff8c00';
                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.color = 'rgba(255, 255, 255, 0.8)';
                                        e.currentTarget.style.transform = 'translateY(0)';
                                    }}
                                >
                                    {item.label}
                                </button>
                            ))}

                            {/* PLAY Button */}
                            <button
                                onClick={scrollToTop}
                                style={{
                                    backgroundColor: '#ff8c00',
                                    color: 'white',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '10px 24px',
                                    fontSize: '15px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    textTransform: 'uppercase',
                                    letterSpacing: '1px',
                                    boxShadow: '0 4px 12px rgba(255, 140, 0, 0.3)',
                                    transition: 'all 0.2s ease',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = '#ff9d1a';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 6px 16px rgba(255, 140, 0, 0.4)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = '#ff8c00';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 4px 12px rgba(255, 140, 0, 0.3)';
                                }}
                            >
                                PLAY
                            </button>
                        </nav>
                    )}
                </div>
            )}

            <div style={{
                minHeight: '100vh', // Ensure page is tall enough to scroll
                width: '100%', // Match the background image width exactly
                margin: 0,
                padding: 0,
                backgroundColor: '#000000', // Pure black background to match gradient
                backgroundImage: backgroundLoaded ? `url(${loginBackground})` : 'none',
                backgroundSize: '100% auto', // Show full width, scale height proportionally
                backgroundPosition: isMobile ? 'center 70px' : 'center top', // Mobile: push down by nav bar height
                backgroundRepeat: 'no-repeat',
                backgroundAttachment: 'scroll',
                fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                color: 'white',
                position: 'relative',
                overflowX: 'hidden', // Prevent horizontal scrolling
                overflowY: 'auto', // Allow vertical scrolling
                boxSizing: 'border-box', // Include padding and border in width calculations
                transition: 'background-image 0.3s ease-in-out',
            }}>
                {/* Gradient Overlay - Very aggressive transition to eliminate flat line */}
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    height: '100%',
                    background: isMobile
                        ? 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0.03) 20%, rgba(0,0,0,0.08) 25%, rgba(0,0,0,0.15) 30%, rgba(0,0,0,0.25) 35%, rgba(0,0,0,0.4) 40%, rgba(0,0,0,0.6) 45%, rgba(0,0,0,0.8) 50%, rgba(0,0,0,0.92) 55%, rgba(0,0,0,1) 60%, rgba(0,0,0,1) 100%)'
                        : 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 4%, rgba(0,0,0,0.08) 8%, rgba(0,0,0,0.2) 12%, rgba(0,0,0,0.4) 16%, rgba(0,0,0,0.65) 20%, rgba(0,0,0,0.85) 23%, rgba(0,0,0,0.96) 25%, rgba(0,0,0,1) 27%, rgba(0,0,0,1) 100%)',
                    pointerEvents: 'none', // Allow clicks to pass through
                    zIndex: 1,
                }} />
                <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'flex-start',
                    alignItems: 'center',
                    minHeight: '100vh',
                    paddingTop: isMobile ? '90px' : 'calc(30vh - 10vw)', // Mobile: account for fixed nav bar (70px + 20px padding). Desktop: ~18vh
                    paddingBottom: '0px',
                    textAlign: 'center',
                    position: 'relative',
                    zIndex: 2, // Ensure content appears above the gradient overlay
                }}>
                    {/* Logo - Hidden on mobile since nav bar has logo */}
                    {!isMobile && (
                        <>
                            {!logoLoaded && (
                                <div style={{
                                    width: 'min(600px, 70vw)',
                                    height: '200px', // Approximate logo height
                                    marginBottom: 'clamp(20px, 4vh, 60px)',
                                    backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                    borderRadius: '12px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    animation: 'pulse 1.5s ease-in-out infinite alternate',
                                }}>
                                    <div style={{
                                        fontSize: '24px',
                                        color: 'rgba(255, 255, 255, 0.5)',
                                        textAlign: 'center',
                                        fontWeight: 'bold',
                                    }}>
                                        BROTH & BULLETS
                                    </div>
                                </div>
                            )}
                            <img
                                src={logo}
                                alt="Broth & Bullets Logo"
                                loading="eager"
                                fetchPriority="high"
                                decoding="sync"
                                style={{
                                    width: 'min(600px, 70vw)', // Responsive: 600px on desktop, 70% of viewport width on mobile (smaller)
                                    maxWidth: '600px',
                                    height: 'auto',
                                    marginBottom: 'clamp(20px, 4vh, 60px)', // Responsive margin, smaller on mobile
                                    display: logoLoaded ? 'block' : 'none',
                                    filter: 'drop-shadow(0 0 20px rgba(0,0,0,0.8)) drop-shadow(0 0 40px rgba(255,255,255,0.2))',
                                    opacity: logoLoaded ? 1 : 0,
                                    transition: 'opacity 0.3s ease-in-out',
                                }}
                            />
                        </>
                    )}

                    <div style={{
                        textAlign: 'center',
                        marginTop: isMobile ? '30vh' : '0', // Push content lower on mobile
                    }}>

                        {/* Display based on authentication and player existence */}
                        {authIsLoading ? (
                            <p>Loading...</p>
                        ) : (authError || connectionError) ? (
                            <>
                                <p style={{
                                    color: 'white',
                                    marginTop: '15px',
                                    fontSize: '12px',
                                    padding: '8px',
                                    backgroundColor: 'rgba(128, 0, 128, 0.1)',
                                    borderRadius: '4px',
                                    marginBottom: '20px',
                                    textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                }}>
                                    {connectionError || authError || 'Connection failed. Please ensure you have an internet connection and try again.'}<br />
                                    {!connectionError && 'If the problem persists, please try signing out and signing in.'}
                                </p>
                                <div style={{ display: 'flex', flexDirection: 'row', gap: '15px', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                                    <button
                                        onClick={() => {
                                            // If it says "refresh your browser", do a page reload
                                            // Otherwise use retry function if available
                                            if (connectionError && connectionError.includes('Please refresh your browser')) {
                                                window.location.reload();
                                            } else if (connectionError && retryConnection) {
                                                retryConnection();
                                            } else {
                                                window.location.reload();
                                            }
                                        }}
                                        disabled={authIsLoading}
                                        onMouseEnter={(e) => {
                                            if (!authIsLoading) {
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.4), 0 0 20px rgba(255,140,0,0.3)';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (!authIsLoading) {
                                                e.currentTarget.style.transform = 'translateY(0)';
                                                e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.4), 0 0 15px rgba(255,140,0,0.4)';
                                            }
                                        }}
                                        style={{
                                            padding: '16px 32px',
                                            border: '2px solid rgba(255, 165, 0, 0.6)',
                                            background: 'linear-gradient(135deg, #ff8c00, #cc6400)',
                                            color: 'white',
                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                            fontSize: '16px',
                                            fontWeight: 'bold',
                                            cursor: authIsLoading ? 'not-allowed' : 'pointer',
                                            boxShadow: '0 4px 15px rgba(0,0,0,0.4), 0 0 15px rgba(255,140,0,0.4)',
                                            display: 'inline-block',
                                            textTransform: 'uppercase',
                                            borderRadius: '8px',
                                            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                            letterSpacing: '1px',
                                            textShadow: '1px 1px 2px rgba(0,0,0,0.7)',
                                            position: 'relative',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        {connectionError && connectionError.includes('Please refresh your browser') ? 'Refresh' : 'Try Again'}
                                    </button>
                                </div>
                            </>
                        ) : isAuthenticated ? (
                            loggedInPlayer ? (
                                // Existing Player: Show welcome message
                                <p style={{
                                    marginBottom: '20px',
                                    fontSize: '14px'
                                }}>
                                    Welcome back, {loggedInPlayer.username}!
                                </p>
                            ) : storedUsername ? (
                                // We have a stored username, so this is an existing player reconnecting
                                <p style={{
                                    marginBottom: '20px',
                                    fontSize: '14px'
                                }}>
                                    {connectionError ?
                                        `Playing as ${storedUsername}` :
                                        `Welcome back, ${storedUsername}!`
                                    }
                                </p>
                            ) : !authError && !connectionError && !localError && !loggedInPlayer && !storedUsername ? (
                                // New Player: Always show username input (don't wait for SpacetimeDB)
                                <div style={{
                                    maxWidth: '350px',
                                    margin: '0 auto',
                                    textAlign: 'left',
                                }}>
                                    <div style={{
                                        marginBottom: '25px',
                                    }}>
                                        <label style={{
                                            display: 'block',
                                            marginBottom: '8px',
                                            fontSize: '13px',
                                            color: 'rgba(255, 255, 255, 0.9)',
                                            fontWeight: '500',
                                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                            letterSpacing: '0.5px',
                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                        }}>
                                            Choose Your Username
                                        </label>
                                        <input
                                            ref={usernameInputRef}
                                            type="text"
                                            placeholder="Enter username"
                                            value={inputUsername}
                                            onChange={(e) => setInputUsername(e.target.value)}
                                            onKeyDown={handleKeyDown}
                                            style={{
                                                width: '100%',
                                                padding: '16px 20px',
                                                background: 'rgba(255, 255, 255, 0.1)',
                                                border: '2px solid rgba(255, 255, 255, 0.3)',
                                                borderRadius: '12px',
                                                color: 'white',
                                                fontSize: '16px',
                                                fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                backdropFilter: 'blur(8px)',
                                                transition: 'all 0.3s ease',
                                                boxShadow: 'inset 0 2px 4px rgba(0, 0, 0, 0.2)',
                                                boxSizing: 'border-box',
                                                outline: 'none',
                                            }}
                                            onFocus={(e) => {
                                                e.currentTarget.style.borderColor = '#ff8c00';
                                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)';
                                                e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.2), 0 0 0 3px rgba(255, 140, 0, 0.2)';
                                            }}
                                            onBlur={(e) => {
                                                e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)';
                                                e.currentTarget.style.background = 'rgba(255, 255, 255, 0.1)';
                                                e.currentTarget.style.boxShadow = 'inset 0 2px 4px rgba(0, 0, 0, 0.2)';
                                            }}
                                        />
                                    </div>
                                </div>
                            ) : (
                                // Other states - show empty
                                <></>
                            )
                        ) : null /* Not loading, no error, not authenticated: Button below will handle Sign In */}

                        {/* Render Login/Join button only if not loading and no authError and (no connectionError OR we have storedUsername) */}
                        {!authIsLoading && !authError && (!connectionError || storedUsername) && !localError && (
                            <form onSubmit={handleSubmit}>
                                <button
                                    type="submit"
                                    // Disable if there's any auth error, or connection error without stored username
                                    disabled={authError !== null || (connectionError !== null && !storedUsername) || localError !== null}
                                    onMouseEnter={(e) => {
                                        const isButtonDisabled = authError !== null || (connectionError !== null && !storedUsername) || localError !== null;
                                        if (!isButtonDisabled) {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.4), 0 0 20px rgba(255,165,0,0.3)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        const isButtonDisabled = authError !== null || (connectionError !== null && !storedUsername) || localError !== null;
                                        if (!isButtonDisabled) {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.4), 0 0 15px rgba(255,140,0,0.4)';
                                        }
                                    }}
                                    style={{
                                        padding: '16px 32px',
                                        border: '2px solid rgba(255, 165, 0, 0.6)',
                                        backgroundColor: (() => {
                                            const isDisabled = authError || (connectionError && !storedUsername) || localError;
                                            return isDisabled ? 'rgba(100, 50, 50, 0.6)' : 'linear-gradient(135deg, rgba(255, 140, 0, 0.9), rgba(200, 100, 0, 0.9))';
                                        })(),
                                        background: (() => {
                                            const isDisabled = authError || (connectionError && !storedUsername) || localError;
                                            return isDisabled ? 'rgba(100, 50, 50, 0.6)' : 'linear-gradient(135deg, #ff8c00, #cc6400)';
                                        })(),
                                        color: (() => {
                                            const isDisabled = authError || (connectionError && !storedUsername) || localError;
                                            return isDisabled ? '#ccc' : 'white';
                                        })(),
                                        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                        fontSize: '16px',
                                        fontWeight: 'bold',
                                        cursor: (() => {
                                            const isDisabled = authError || (connectionError && !storedUsername) || localError;
                                            return isDisabled ? 'not-allowed' : 'pointer';
                                        })(),
                                        boxShadow: (() => {
                                            const isDisabled = authError || (connectionError && !storedUsername) || localError;
                                            return isDisabled ? '2px 2px 6px rgba(0,0,0,0.4)' : '0 4px 15px rgba(0,0,0,0.4), 0 0 15px rgba(255,140,0,0.4)';
                                        })(),
                                        display: 'inline-block',
                                        boxSizing: 'border-box',
                                        textTransform: 'uppercase',
                                        borderRadius: '8px',
                                        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                                        letterSpacing: '1px',
                                        textShadow: '1px 1px 2px rgba(0,0,0,0.7)',
                                        position: 'relative',
                                        overflow: 'hidden',
                                    }}
                                >
                                    {(() => {
                                        if (!isAuthenticated) return 'Start Your Journey';
                                        return 'Join Game';
                                    })()}
                                </button>

                                {/* Mobile: Account info lives in hamburger menu - keeps main area clean */}

                                {/* Version Text with Learn More */}
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '12px',
                                    marginTop: '19px',
                                }}>
                                    {/* First row: Early Access text and Learn More button */}
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '17px',
                                    }}>
                                        <span style={{
                                            fontSize: '13.5px',
                                            color: 'rgba(255, 255, 255, 0.97)',
                                            fontWeight: 600,
                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                            textShadow: '1px 1px 3px rgba(60,18,0,0.7)',
                                            letterSpacing: '0.7px',
                                        }}>
                                            Early Access Alpha v0.82
                                        </span>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                smoothScrollTo('[data-about-section]');
                                            }}
                                            style={{
                                                background: 'linear-gradient(90deg, #ffe0b2, #ffd180 40%, #ff8c00 90%, #cc6400)',
                                                border: 'none',
                                                color: '#852100',
                                                fontWeight: 800,
                                                padding: '7px 22px',
                                                fontSize: '13px',
                                                borderRadius: '18px',
                                                boxShadow: '0 1.5px 11px 2px rgba(0,0,0,0.08)',
                                                cursor: 'pointer',
                                                fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                textShadow: '1px 1px 3px rgba(255,255,255,0.15)',
                                                transition: 'all 0.22s cubic-bezier(0.63, 0.1, 0.32, 1), box-shadow 0.13s',
                                                letterSpacing: '1.2px',
                                                position: 'relative',
                                                userSelect: 'none',
                                                overflow: 'hidden'
                                            }}
                                            className={isGleaming ? 'gleam-animating' : ''}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.background =
                                                    'linear-gradient(92deg, #fff3e0, #ffb94f 50%, #ff8c00 90%, #e67c00)';
                                                e.currentTarget.style.color = '#7a2200';
                                                e.currentTarget.style.boxShadow = '0 0 21px 2px rgba(255,220,120,0.48), 0 3px 12px 0 rgba(0,0,0,0.22)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.background = 'linear-gradient(90deg, #ffe0b2, #ffd180 40%, #ff8c00 90%, #cc6400)';
                                                e.currentTarget.style.color = '#852100';
                                                e.currentTarget.style.boxShadow = '0 1.5px 11px 2px rgba(0,0,0,0.08)';
                                            }}
                                        >
                                            <span
                                                style={{
                                                    fontWeight: 800,
                                                    textTransform: "uppercase",
                                                    letterSpacing: "1.8px",
                                                    fontSize: 'inherit',
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                    position: 'relative',
                                                    zIndex: 1
                                                }}
                                            >
                                                learn more
                                            </span>
                                        </button>
                                    </div>

                                    {/* Live player count (visible when Spacetime connected and props provided) */}
                                    {isSpacetimeConnected && typeof onlinePlayerCount === 'number' && typeof maxPlayerCount === 'number' && (
                                        <div style={{
                                            padding: '6px 12px',
                                            backgroundColor: 'rgba(0, 0, 0, 0.65)',
                                            borderRadius: '10px',
                                        }}>
                                            <span style={{
                                                fontSize: '12px',
                                                color: (() => {
                                                    if (onlinePlayerCount >= maxPlayerCount) return 'rgba(255, 120, 120, 0.98)';
                                                    if (onlinePlayerCount >= maxPlayerCount - 5) return 'rgba(255, 200, 100, 0.98)';
                                                    return 'rgba(255, 255, 255, 0.85)';
                                                })(),
                                                fontWeight: 500,
                                                fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                letterSpacing: '0.5px',
                                            }}>
                                                Players Online: {onlinePlayerCount} / {maxPlayerCount}
                                            </span>
                                        </div>
                                    )}

                                    {/* Disclaimer: server wipe notice */}
                                    <div style={{
                                        padding: '8px 14px',
                                        backgroundColor: 'rgba(0, 0, 0, 0.65)',
                                        borderRadius: '10px',
                                        maxWidth: '340px',
                                    }}>
                                        <span style={{
                                            fontSize: '11px',
                                            color: 'rgba(255, 220, 180, 0.98)',
                                            fontWeight: 500,
                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                            textShadow: '1px 1px 2px rgba(0,0,0,0.9)',
                                            letterSpacing: '0.4px',
                                            lineHeight: '1.4',
                                            textAlign: 'center',
                                            display: 'block',
                                        }}>
                                            We're in Early Access Alpha. The server may be wiped anytime for updates, migrations, or fixes. Treat progress as temporary and enjoy the journey.
                                        </span>
                                    </div>

                                    {/* Second row: System Requirements and FAQ buttons */}
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap' }}>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setShowSystemRequirements(true);
                                            }}
                                            style={{
                                                background: 'rgba(0, 0, 0, 0.5)',
                                                border: '1px solid rgba(255, 140, 0, 0.6)',
                                                color: '#ffb366',
                                                fontWeight: 600,
                                                padding: '6px 16px',
                                                fontSize: '11px',
                                                borderRadius: '14px',
                                                cursor: 'pointer',
                                                fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                boxShadow: '0 0 12px rgba(255, 140, 0, 0.2)',
                                                transition: 'all 0.2s ease',
                                                letterSpacing: '0.8px',
                                                textTransform: 'uppercase',
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.borderColor = 'rgba(255, 140, 0, 0.9)';
                                                e.currentTarget.style.color = '#ffcc99';
                                                e.currentTarget.style.background = 'rgba(255, 140, 0, 0.25)';
                                                e.currentTarget.style.boxShadow = '0 0 16px rgba(255, 140, 0, 0.35)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.borderColor = 'rgba(255, 140, 0, 0.6)';
                                                e.currentTarget.style.color = '#ffb366';
                                                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)';
                                                e.currentTarget.style.boxShadow = '0 0 12px rgba(255, 140, 0, 0.2)';
                                            }}
                                        >
                                            System Requirements
                                        </button>
                                        <button
                                            type="button"
                                            onClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                smoothScrollTo('[data-faq-section]');
                                            }}
                                            style={{
                                                background: 'rgba(0, 0, 0, 0.5)',
                                                border: '1px solid rgba(255, 140, 0, 0.6)',
                                                color: '#ffb366',
                                                fontWeight: 600,
                                                padding: '6px 16px',
                                                fontSize: '11px',
                                                borderRadius: '14px',
                                                cursor: 'pointer',
                                                fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                boxShadow: '0 0 12px rgba(255, 140, 0, 0.2)',
                                                transition: 'all 0.2s ease',
                                                letterSpacing: '0.8px',
                                                textTransform: 'uppercase',
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.borderColor = 'rgba(255, 140, 0, 0.9)';
                                                e.currentTarget.style.color = '#ffcc99';
                                                e.currentTarget.style.background = 'rgba(255, 140, 0, 0.25)';
                                                e.currentTarget.style.boxShadow = '0 0 16px rgba(255, 140, 0, 0.35)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.borderColor = 'rgba(255, 140, 0, 0.6)';
                                                e.currentTarget.style.color = '#ffb366';
                                                e.currentTarget.style.background = 'rgba(0, 0, 0, 0.5)';
                                                e.currentTarget.style.boxShadow = '0 0 12px rgba(255, 140, 0, 0.2)';
                                            }}
                                        >
                                            FAQ
                                        </button>
                                    </div>

                                    <style>{`
                                    .gleam-animating::before {
                                        content: '';
                                        position: absolute;
                                        top: 0;
                                        left: -100%;
                                        width: 60%;
                                        height: 100%;
                                        background: linear-gradient(
                                            90deg,
                                            transparent 0%,
                                            rgba(255, 255, 255, 0.1) 25%,
                                            rgba(255, 255, 255, 0.4) 50%,
                                            rgba(255, 255, 255, 0.1) 75%,
                                            transparent 100%
                                        );
                                        transform: skewX(-20deg);
                                        animation: gleamkeyframes 0.6s ease-out forwards;
                                        pointer-events: none;
                                    }
                                    @keyframes gleamkeyframes {
                                        0% { left: -100%; }
                                        100% { left: 150%; }
                                    }
                                `}
                                    </style>
                                </div>
                            </form>
                        )}

                        {/* System Requirements popup */}
                        {showSystemRequirements && (
                            <div
                                style={{
                                    position: 'fixed',
                                    top: 0,
                                    left: 0,
                                    right: 0,
                                    bottom: 0,
                                    backgroundColor: 'rgba(0, 0, 0, 0.85)',
                                    zIndex: 9999,
                                    display: 'flex',
                                    justifyContent: 'center',
                                    alignItems: 'center',
                                    backdropFilter: 'blur(8px)',
                                }}
                                onClick={() => setShowSystemRequirements(false)}
                            >
                                <div
                                    style={{
                                        width: isMobile ? '95%' : '520px',
                                        maxWidth: '95vw',
                                        maxHeight: '85vh',
                                        background: 'rgba(40, 40, 60, 0.98)',
                                        border: '2px solid rgba(255, 140, 0, 0.4)',
                                        borderRadius: '16px',
                                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
                                        fontFamily: UI_FONT_FAMILY,
                                        overflow: 'auto',
                                        padding: '28px 32px',
                                        position: 'relative',
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                >
                                    <h3 style={{
                                        margin: '0 0 20px 0',
                                        color: '#ff8c00',
                                        fontSize: '20px',
                                        fontWeight: 700,
                                        textTransform: 'uppercase',
                                        letterSpacing: '1.2px',
                                    }}>
                                        System Requirements & Best Practices
                                    </h3>
                                    <div style={{ color: 'rgba(255, 255, 255, 0.9)', fontSize: '14px', lineHeight: 1.6, textAlign: 'left' }}>
                                        <p style={{ marginTop: 0, marginBottom: '12px' }}>
                                            <strong>Minimum:</strong> Modern browser (Chrome, Firefox, Edge), 4GB RAM, stable internet connection.
                                        </p>
                                        <p style={{ marginBottom: '12px' }}>
                                            <strong>Recommended:</strong> 8GB+ RAM, GPU for faster canvas rendering, broadband connection.
                                        </p>
                                        <p style={{ marginBottom: '16px' }}>
                                            Broth and Bullets runs in your browser and shares CPU, GPU, and memory with other apps. For best performance:
                                        </p>
                                        <ul style={{ margin: '0 0 16px 0', paddingLeft: '20px', textAlign: 'left' }}>
                                            <li style={{ marginBottom: '8px' }}>Close other games in the background</li>
                                            <li style={{ marginBottom: '8px' }}>Close unnecessary browser tabs</li>
                                            <li style={{ marginBottom: '8px' }}>Close heavy apps (video editors, IDEs, etc.)</li>
                                            <li style={{ marginBottom: '8px' }}>Use a wired connection if possible</li>
                                            <li style={{ marginBottom: '8px' }}>Close other games even when minimized</li>
                                        </ul>
                                        <p style={{ marginBottom: 0, fontSize: '13px', color: 'rgba(255, 255, 255, 0.75)' }}>
                                            Running multiple heavy applications at once will cause noticeable slowdown. For the smoothest experience, play Broth and Bullets when no other demanding games are running.
                                        </p>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setShowSystemRequirements(false)}
                                        style={{
                                            marginTop: '16px',
                                            padding: '10px 24px',
                                            background: 'linear-gradient(90deg, #ffe0b2, #ff8c00 90%, #cc6400)',
                                            border: 'none',
                                            color: '#852100',
                                            fontWeight: 700,
                                            fontSize: '13px',
                                            borderRadius: '8px',
                                            cursor: 'pointer',
                                            fontFamily: UI_FONT_FAMILY,
                                        }}
                                    >
                                        Close
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Show error state with Refresh button for connection-related localErrors */}
                        {!authIsLoading && !authError && !connectionError && localError && (localError.includes('Connection error') || localError.includes('Quantum tunnel collapsed') || localError.includes('Please refresh your browser')) && localError !== connectionError && (
                            <>
                                <p style={{
                                    color: 'white',
                                    marginTop: '15px',
                                    fontSize: '12px',
                                    padding: '8px',
                                    backgroundColor: 'rgba(128, 0, 128, 0.1)',
                                    borderRadius: '4px',
                                    marginBottom: '20px',
                                    textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                }}>
                                    {localError}
                                </p>
                                <button
                                    onClick={() => window.location.reload()}
                                    style={{
                                        padding: '12px 24px',
                                        border: '1px solid rgba(255, 255, 255, 0.3)',
                                        backgroundColor: 'rgba(255, 140, 0, 0.8)', // Orange for retry
                                        color: 'white',
                                        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                        fontSize: '14px',
                                        cursor: 'pointer',
                                        boxShadow: '2px 2px 4px rgba(0,0,0,0.4)',
                                        textTransform: 'uppercase',
                                        borderRadius: '4px',
                                        fontWeight: 'bold',
                                        width: 'auto',
                                        minWidth: '120px',
                                    }}
                                >
                                    Refresh
                                </button>
                            </>
                        )}

                        {/* Local Error Messages (e.g., for username validation) - show if not authError and not connection error */}
                        {localError && !authError && !localError.includes('Connection error') && !localError.includes('Quantum tunnel collapsed') && !localError.includes('Please refresh your browser') && localError !== connectionError && (
                            <p style={{
                                color: 'white',
                                marginTop: '0px',
                                marginBottom: '15px',
                                fontSize: '12px',
                                padding: '8px',
                                backgroundColor: 'rgba(128, 0, 128, 0.1)',
                                borderRadius: '4px',
                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                            }}>
                                {localError}
                            </p>
                        )}

                        {/* Content Section - Game Tools */}
                        <div style={{ paddingTop: '60px' }}> {/* Add margin at top for proper spacing */}

                            {/* About & FAQ Section */}
                            <div data-content-section style={{
                                marginTop: '15vh',
                                marginBottom: '80px',
                                padding: '0 clamp(20px, 5vw, 40px)', // Responsive horizontal padding: 20px on mobile, up to 40px on desktop
                                width: '100%',
                                maxWidth: '100%', // Use 100% instead of 100vw to prevent scrollbar
                                boxSizing: 'border-box',
                                overflowX: 'hidden', // Ensure no horizontal overflow from children
                            }}>
                                {/* About Section */}
                                <div data-about-section style={{
                                    backgroundColor: 'rgba(0, 0, 0, 0.75)',
                                    backdropFilter: 'blur(12px)',
                                    borderRadius: '16px',
                                    padding: 'clamp(30px, 6vw, 60px) clamp(20px, 5vw, 40px)', // Responsive padding: smaller on mobile
                                    margin: '0 auto 60px auto',
                                    maxWidth: '800px',
                                    width: '100%',
                                    border: '2px solid rgba(255, 255, 255, 0.3)',
                                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                                    textAlign: 'center',
                                    boxSizing: 'border-box',
                                    overflowX: 'hidden',
                                }}>
                                    <div style={{
                                        fontSize: '14px',
                                        color: '#ff8c00',
                                        fontWeight: '600',
                                        textTransform: 'uppercase',
                                        letterSpacing: '4px',
                                        marginBottom: '30px',
                                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                    }}>
                                        ABOUT
                                    </div>

                                    <h2 style={{
                                        fontSize: 'clamp(36px, 5vw, 56px)', // Responsive font size
                                        marginBottom: '40px',
                                        color: 'white',
                                        textAlign: 'center',
                                        textShadow: '2px 2px 6px rgba(0,0,0,0.9)',
                                        lineHeight: '1.1',
                                        fontWeight: 'bold',
                                        letterSpacing: '-1px',
                                    }}>
                                        FROM HUMBLE BROTHS<br />
                                        TO TRADING EMPIRES
                                    </h2>

                                    <p style={{
                                        fontSize: '18px',
                                        lineHeight: '1.8',
                                        color: 'rgba(255, 255, 255, 0.9)',
                                        textAlign: 'center',
                                        textShadow: '1px 1px 3px rgba(0,0,0,0.8)',
                                        maxWidth: '800px',
                                        margin: '0 auto',
                                    }}>
                                        Where <strong>Rust's</strong> intense survival meets <strong>Blazing Beaks'</strong> quirky combat, all wrapped in <strong>Stardew Valley's&nbsp;</strong>
                                        cozy farming vibes. You've washed ashore as a weathered babushka, resourceful, stubborn, and far from finished.
                                        Every meal you cook could save a life. Every trade could build a friendship. Farm while the sun shines, but when the light fades...
                                        something stirs. Something that remembers. Build from simple shelters to thriving homesteads, find neighbors who become family,
                                        and uncover what ancient force haunts this island.
                                    </p>

                                    <p style={{
                                        fontSize: '15px',
                                        lineHeight: '1.6',
                                        color: 'rgba(255, 200, 150, 0.95)',
                                        textAlign: 'center',
                                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                        maxWidth: '700px',
                                        margin: '24px auto 0',
                                    }}>
                                        Want to play offline solo? Clone the repo, follow the <a href="https://github.com/SeloSlav/vibe-coding-starter-pack-2d-multiplayer-survival/blob/main/README.md" target="_blank" rel="noopener noreferrer" style={{ color: '#ff8c00', textDecoration: 'underline' }}>Quick Local Setup in the README</a>, and play fully offline. Run <code style={{ backgroundColor: 'rgba(0,0,0,0.4)', padding: '2px 6px', borderRadius: '4px', fontSize: '14px' }}>git pull</code> when you want updates.{' '}
                                        <button
                                            type="button"
                                            onClick={() => smoothScrollTo('[data-faq-section]')}
                                            style={{
                                                background: 'none',
                                                border: 'none',
                                                color: '#ff8c00',
                                                textDecoration: 'underline',
                                                cursor: 'pointer',
                                                fontWeight: 600,
                                                padding: 0,
                                                fontFamily: 'inherit',
                                                fontSize: 'inherit',
                                            }}
                                        >
                                            See FAQ for details
                                        </button>
                                    </p>
                                </div>

                                {/* Tools Section */}
                                <div data-tools-section style={{
                                    backgroundColor: 'rgba(0, 0, 0, 0.75)',
                                    backdropFilter: 'blur(12px)',
                                    borderRadius: '16px',
                                    padding: 'clamp(30px, 6vw, 60px) clamp(20px, 5vw, 40px)', // Responsive padding: smaller on mobile
                                    margin: '0 auto 60px auto',
                                    maxWidth: '800px',
                                    width: '100%',
                                    border: '2px solid rgba(255, 255, 255, 0.3)',
                                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                                    textAlign: 'center',
                                    boxSizing: 'border-box',
                                    overflowX: 'hidden',
                                }}>
                                    <div style={{
                                        fontSize: '14px',
                                        color: '#ff8c00',
                                        fontWeight: '600',
                                        textTransform: 'uppercase',
                                        letterSpacing: '4px',
                                        marginBottom: '30px',
                                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                    }}>
                                        YOUR INITIAL LOADOUT
                                    </div>

                                    <h2 style={{
                                        fontSize: 'clamp(36px, 5vw, 56px)',
                                        marginBottom: '30px',
                                        color: 'white',
                                        textAlign: 'center',
                                        textShadow: '2px 2px 6px rgba(0,0,0,0.9)',
                                        lineHeight: '1.1',
                                        fontWeight: 'bold',
                                        letterSpacing: '-1px',
                                    }}>
                                        WHAT SURVIVED<br />
                                        THE SHIPWRECK
                                    </h2>

                                    {/* Shipwreck Carousel */}
                                    <ShipwreckCarousel />
                                </div>

                                {/* Game Features Section */}
                                <div data-features-section style={{
                                    backgroundColor: 'rgba(0, 0, 0, 0.75)',
                                    backdropFilter: 'blur(12px)',
                                    borderRadius: '16px',
                                    padding: 'clamp(30px, 6vw, 60px) clamp(20px, 5vw, 40px)', // Responsive padding: smaller on mobile
                                    margin: '0 auto 60px auto',
                                    maxWidth: '800px',
                                    width: '100%',
                                    border: '2px solid rgba(255, 255, 255, 0.3)',
                                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                                    textAlign: 'center',
                                    boxSizing: 'border-box',
                                    overflowX: 'hidden',
                                }}>
                                    <div style={{
                                        fontSize: '14px',
                                        color: '#ff8c00',
                                        fontWeight: '600',
                                        textTransform: 'uppercase',
                                        letterSpacing: '4px',
                                        marginBottom: '30px',
                                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                    }}>
                                        GAME FEATURES
                                    </div>

                                    <h2 style={{
                                        fontSize: 'clamp(36px, 5vw, 56px)',
                                        marginBottom: '30px',
                                        color: 'white',
                                        textAlign: 'center',
                                        textShadow: '2px 2px 6px rgba(0,0,0,0.9)',
                                        lineHeight: '1.1',
                                        fontWeight: 'bold',
                                        letterSpacing: '-1px',
                                    }}>
                                        BUILD YOUR EMPIRE<br />
                                        FORGE YOUR DESTINY
                                    </h2>

                                    {/* Gameplay Features Carousel */}
                                    <GameplayFeaturesCarousel />
                                </div>

                                {/* Blog Section */}
                                <div data-blog-section style={{
                                    backgroundColor: 'rgba(0, 0, 0, 0.75)',
                                    backdropFilter: 'blur(12px)',
                                    borderRadius: '16px',
                                    padding: 'clamp(30px, 6vw, 60px) clamp(20px, 5vw, 40px)',
                                    margin: '0 auto 60px auto',
                                    maxWidth: '800px',
                                    width: '100%',
                                    border: '2px solid rgba(255, 255, 255, 0.3)',
                                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                                    boxSizing: 'border-box',
                                    overflowX: 'hidden',
                                }}>
                                    <div style={{
                                        fontSize: '14px',
                                        color: '#ff8c00',
                                        fontWeight: '600',
                                        textTransform: 'uppercase',
                                        letterSpacing: '4px',
                                        marginBottom: '30px',
                                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                        textAlign: 'center',
                                    }}>
                                        LATEST NEWS
                                    </div>

                                    <h2 style={{
                                        fontSize: 'clamp(36px, 5vw, 56px)',
                                        marginBottom: '60px',
                                        color: 'white',
                                        textAlign: 'center',
                                        textShadow: '2px 2px 6px rgba(0,0,0,0.9)',
                                        lineHeight: '1.1',
                                        fontWeight: 'bold',
                                        letterSpacing: '-1px',
                                    }}>
                                        FROM THE<br />
                                        DEVELOPER'S DESK
                                    </h2>

                                    {/* Blog Posts Grid */}
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                                        gap: '24px',
                                        marginBottom: '40px',
                                    }}>
                                        {blogPosts.slice(0, 2).map((post: any) => {
                                            const formattedDate = new Date(post.date).toLocaleDateString('en-US', {
                                                year: 'numeric',
                                                month: 'long',
                                                day: 'numeric'
                                            });

                                            return (
                                                <div
                                                    key={post.slug}
                                                    onClick={() => window.location.href = `/blog/${post.slug}`}
                                                    style={{
                                                        backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                                        borderRadius: '12px',
                                                        padding: '24px',
                                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                                        cursor: 'pointer',
                                                        transition: 'all 0.3s ease',
                                                        boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
                                                    }}
                                                    onMouseEnter={(e) => {
                                                        e.currentTarget.style.transform = 'translateY(-4px)';
                                                        e.currentTarget.style.borderColor = 'rgba(255, 140, 0, 0.5)';
                                                        e.currentTarget.style.boxShadow = '0 8px 24px rgba(255, 140, 0, 0.2)';
                                                    }}
                                                    onMouseLeave={(e) => {
                                                        e.currentTarget.style.transform = 'translateY(0)';
                                                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                                                        e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.3)';
                                                    }}
                                                >
                                                    {post.coverImage && (
                                                        <div style={{
                                                            width: '100%',
                                                            height: '180px',
                                                            borderRadius: '8px',
                                                            overflow: 'hidden',
                                                            marginBottom: '16px',
                                                        }}>
                                                            <img
                                                                src={post.coverImage}
                                                                alt={post.title}
                                                                style={{
                                                                    width: '100%',
                                                                    height: '100%',
                                                                    objectFit: 'cover',
                                                                }}
                                                            />
                                                        </div>
                                                    )}

                                                    <div style={{
                                                        fontSize: '12px',
                                                        color: '#ff8c00',
                                                        marginBottom: '8px',
                                                        fontWeight: '600',
                                                    }}>
                                                        {formattedDate}
                                                    </div>

                                                    <h3 style={{
                                                        fontSize: '20px',
                                                        fontWeight: 'bold',
                                                        color: 'white',
                                                        marginBottom: '12px',
                                                        lineHeight: '1.3',
                                                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                    }}>
                                                        {post.title}
                                                    </h3>

                                                    <p style={{
                                                        fontSize: '14px',
                                                        color: 'rgba(255, 255, 255, 0.7)',
                                                        lineHeight: '1.6',
                                                        marginBottom: '16px',
                                                    }}>
                                                        {post.subtitle}
                                                    </p>

                                                    <div style={{
                                                        fontSize: '14px',
                                                        color: '#ff8c00',
                                                        fontWeight: '600',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                    }}>
                                                        Read More
                                                        <span style={{ fontSize: '16px' }}>→</span>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Read More Button */}
                                    <div style={{
                                        textAlign: 'center',
                                    }}>
                                        <button
                                            onClick={() => window.location.href = '/blog'}
                                            style={{
                                                backgroundColor: '#ff8c00',
                                                color: 'white',
                                                border: 'none',
                                                borderRadius: '8px',
                                                padding: '16px 40px',
                                                fontSize: '16px',
                                                fontWeight: 'bold',
                                                cursor: 'pointer',
                                                textTransform: 'uppercase',
                                                letterSpacing: '1px',
                                                boxShadow: '0 4px 16px rgba(255, 140, 0, 0.3)',
                                                transition: 'all 0.3s ease',
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.backgroundColor = '#ff9d1a';
                                                e.currentTarget.style.transform = 'translateY(-2px)';
                                                e.currentTarget.style.boxShadow = '0 6px 20px rgba(255, 140, 0, 0.4)';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.backgroundColor = '#ff8c00';
                                                e.currentTarget.style.transform = 'translateY(0)';
                                                e.currentTarget.style.boxShadow = '0 4px 16px rgba(255, 140, 0, 0.3)';
                                            }}
                                        >
                                            View All Blog Posts
                                        </button>
                                    </div>
                                </div>

                                {/* FAQ Section */}
                                <div data-faq-section style={{
                                    backgroundColor: 'rgba(0, 0, 0, 0.75)',
                                    backdropFilter: 'blur(12px)',
                                    borderRadius: '16px',
                                    padding: 'clamp(30px, 6vw, 60px) clamp(20px, 5vw, 40px)', // Responsive padding: smaller on mobile
                                    margin: '0 auto',
                                    maxWidth: '800px',
                                    width: '100%',
                                    border: '2px solid rgba(255, 255, 255, 0.3)',
                                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                                    boxSizing: 'border-box',
                                    overflowX: 'hidden',
                                }}>
                                    <div style={{
                                        fontSize: '14px',
                                        color: '#ff8c00',
                                        fontWeight: '600',
                                        textTransform: 'uppercase',
                                        letterSpacing: '4px',
                                        marginBottom: '30px',
                                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                        textAlign: 'center',
                                    }}>
                                        FAQ
                                    </div>

                                    <h2 style={{
                                        fontSize: 'clamp(36px, 5vw, 56px)', // Responsive font size
                                        marginBottom: '60px',
                                        color: 'white',
                                        textAlign: 'center',
                                        textShadow: '2px 2px 6px rgba(0,0,0,0.9)',
                                        lineHeight: '1.1',
                                        fontWeight: 'bold',
                                        letterSpacing: '-1px',
                                    }}>
                                        FREQUENTLY<br />
                                        ASKED QUESTIONS
                                    </h2>

                                    {/* FAQ Items */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                        {[
                                            {
                                                question: "WHAT IS BROTH & BULLETS?",
                                                answer: "A cooperative multiplayer survival and farming game where you work with other players to survive a harsh, persistent world. You've washed ashore on a strange island with nothing but grit and a lifetime of hard-won wisdom. Here, resourceful babushkas build thriving homesteads together, cooking life-saving meals, weathering harsh seasons side by side, trading what they grow for what they need. The world keeps turning whether you're there or not. Your crops keep growing. Your neighbors keep building. And when darkness falls, the island remembers things best left forgotten."
                                            },
                                            {
                                                question: "CAN I PLAY OFFLINE SOLO?",
                                                answer: (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                                        <p style={{ margin: 0, fontSize: '16px', lineHeight: '1.7', color: 'rgba(255, 255, 255, 0.85)' }}>
                                                            Yes! You can run the game fully offline on your own machine. Clone the repo in a terminal:
                                                        </p>
                                                        <code style={{
                                                            display: 'block',
                                                            padding: '12px 16px',
                                                            backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                                            borderRadius: '8px',
                                                            fontFamily: 'monospace',
                                                            fontSize: '14px',
                                                            color: '#ffb366',
                                                            border: '1px solid rgba(255, 140, 0, 0.4)',
                                                            overflowX: 'auto',
                                                        }}>
                                                            git clone https://github.com/SeloSlav/vibe-coding-starter-pack-2d-multiplayer-survival.git
                                                        </code>
                                                        <p style={{ margin: 0, fontSize: '16px', lineHeight: '1.7', color: 'rgba(255, 255, 255, 0.85)' }}>
                                                            Then follow the <a href="https://github.com/SeloSlav/vibe-coding-starter-pack-2d-multiplayer-survival/blob/main/README.md" target="_blank" rel="noopener noreferrer" style={{ color: '#ffb366', textDecoration: 'underline' }}>Quick Local Setup in the README</a>. Just run <code style={{ backgroundColor: 'rgba(0,0,0,0.4)', padding: '2px 6px', borderRadius: '4px', fontSize: '14px' }}>git pull</code> when you want the latest updates.
                                                        </p>
                                                    </div>
                                                )
                                            },
                                            {
                                                question: "HOW DO I START SURVIVING?",
                                                answer: "You begin with basic survival gear and a lifetime of accumulated wisdom. Hunt wild animals, gather plant fibers, collect wood and stone to build your first campfire. Use the daylight wisely to farm, craft, and prepare. When darkness falls, find shelter, or face what emerges from it. Work with neighbors to survive what you couldn't alone. Hold V anytime to talk to SOVA, your in-game virtual assistant. She'll get you on the right track."
                                            },
                                            {
                                                question: "WHAT'S SO SPECIAL ABOUT BREWING?",
                                                answer: "Every recipe matters for survival! Attach your field cauldron to a campfire or natural heat source like a fumarole in the rocky crags to get cooking. Fill it with water and place any 3 ingredients to create a special combination with all sorts of effects. Discover them all. Brew healing broths from gathered herbs, create nutritious soups from farmed vegetables, ferment preserves to store food through harsh winters, and craft warming drinks to survive freezing temperatures. Preservation is key. Learn to dry, pickle, and ferment your harvest before the seasons turn. Master brewers become invaluable community members whose recipes can mean the difference between thriving and starving."
                                            },
                                            {
                                                question: "CAN I FARM AND RAISE ANIMALS?",
                                                answer: "Absolutely! Plant and tend crops through the changing seasons, but beware of harsh weather. Heavy rain can damage crops, frost can kill them, and drought brings its own challenges. Learn to preserve your harvest through drying, fermenting, and storage. Build fences to protect livestock from wild predators. Your farm becomes the foundation of both your survival and your community's food security."
                                            },
                                            {
                                                question: "HOW DOES BUILDING WORK?",
                                                answer: "Start with simple shelters made from plant fiber and wood, then expand into proper homesteads with kitchens, storage, workshops, and insulated walls. Build structures that protect against the elements. Roofs keep out rain, walls block wind, and proper insulation helps survive freezing winters. Coordinate with neighbors to create thriving villages with shared resources and communal spaces."
                                            },
                                            {
                                                question: "HOW DOES TRADING WORK?",
                                                answer: "The island's markets breathe with real supply and demand. Deliver materials to substations across the island; they feed into the ALK central compound, where an AI adjusts prices based on what the island needs. Sometimes ALK wants more of one thing than another. It can be temperamental. Nobody quite knows what it's doing. Sell your surplus crops when prices climb, stock up on materials when they drop. Prices shift naturally as the community produces and consumes. A bountiful harvest drives prices down; a harsh winter sends them soaring. Seasonal changes, storms, and community needs create constantly shifting opportunities for those clever enough to read the winds."
                                            },
                                            {
                                                question: "WILL MY NEIGHBORS TRY TO KILL ME?",
                                                answer: "This island has enough horrors without us turning on each other. We didn't want PVP to be the focus. For now it's about collective survival. Think of it as an eerie survival and farming sim rather than a cozy one. If you do want to fight other players, type /pvp to flag yourself for 30 minutes. Anyone who attacks you also becomes PVP flagged. Maybe later we'll add PVP exclusive zones, but for now you're fighting what lurks here, not your fellow survivors. When night falls, the darkness brings things that hunger for the living. You'll need every neighbor you have."
                                            },
                                            {
                                                question: "WILL MY PROGRESS BE WIPED?",
                                                answer: "Yes. The server is subject to be wiped at any time for any reason, meaning all items and progress may be lost. Reasons include: critical bugs, balancing updates, database migrations, server maintenance, or other development needs. We're in Early Access Alpha; treat your progress as temporary and enjoy the journey while it lasts."
                                            },
                                            {
                                                question: "WHAT'S THE FUTURE HOLD?",
                                                answer: (
                                                <>
                                                    <p style={{ margin: '0 0 16px 0' }}>
                                                        A thriving network of settlements where survivors build lasting legacies together. Whether you spend your days tending crops in the sunshine or braving what comes after dark, there's a place for you. The island holds deeper secrets yet to be uncovered: ancient recipes, forgotten techniques, and perhaps answers to what corruption took root here long before any of us arrived. Seasons already test the hardiest souls.
                                                    </p>
                                                    <p style={{ margin: '0 0 16px 0' }}>
                                                        Our server architecture allows an insane amount of scaling, and we'd like to keep going. Think of the island as the starter zone. The vision is much more immense: a deep ocean biome with advanced water and aircraft, volcanic biomes, underground caverns beneath the island, and the Peninsula, where the cyberpunk metropolis of Gred rises from the lore of the <a href="https://mybook.to/babushkabook" target="_blank" rel="noopener noreferrer" style={{ color: '#ffb366', textDecoration: 'underline' }}>Babushka books</a>. Who knows how big this could get!
                                                    </p>
                                                </>
                                            )
                                            }
                                        ].map((faq, index) => {
                                            const isExpanded = expandedFaqIndex === index;
                                            return (
                                                <div key={index} style={{
                                                    backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                                    border: '1px solid rgba(255, 255, 255, 0.2)',
                                                    borderRadius: '12px',
                                                    overflow: 'hidden',
                                                    transition: 'all 0.3s ease',
                                                    width: '100%',
                                                    boxSizing: 'border-box',
                                                    wordWrap: 'break-word',
                                                }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => setExpandedFaqIndex(isExpanded ? null : index)}
                                                        style={{
                                                            width: '100%',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'space-between',
                                                            gap: '12px',
                                                            padding: 'clamp(16px, 3vw, 24px) clamp(20px, 4vw, 32px)',
                                                            background: isExpanded ? 'rgba(255, 140, 0, 0.08)' : 'none',
                                                            border: 'none',
                                                            cursor: 'pointer',
                                                            textAlign: 'left',
                                                            fontFamily: UI_FONT_FAMILY,
                                                            transition: 'background 0.2s ease',
                                                        }}
                                                        onMouseEnter={(e) => {
                                                            if (!isExpanded) e.currentTarget.style.background = 'rgba(255, 140, 0, 0.06)';
                                                        }}
                                                        onMouseLeave={(e) => {
                                                            if (!isExpanded) e.currentTarget.style.background = 'none';
                                                        }}
                                                    >
                                                        <h3 style={{
                                                            fontSize: '18px',
                                                            color: '#ff8c00',
                                                            margin: 0,
                                                            fontWeight: 'bold',
                                                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                            letterSpacing: '1px',
                                                            flex: 1,
                                                        }}>
                                                            {faq.question}
                                                        </h3>
                                                        <FontAwesomeIcon
                                                            icon={isExpanded ? faChevronDown : faChevronRight}
                                                            style={{
                                                                color: '#ff8c00',
                                                                fontSize: '14px',
                                                                flexShrink: 0,
                                                                transition: 'transform 0.2s ease',
                                                            }}
                                                        />
                                                    </button>
                                                    {isExpanded && (
                                                        <div style={{
                                                            fontSize: '16px',
                                                            lineHeight: '1.7',
                                                            color: 'rgba(255, 255, 255, 0.85)',
                                                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                            textAlign: 'left',
                                                            padding: '16px clamp(20px, 4vw, 32px) 24px',
                                                            margin: 0,
                                                            overflowX: 'hidden',
                                                            borderTop: '1px solid rgba(255, 255, 255, 0.15)',
                                                        }}>
                                                            {faq.answer}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                    })}
                                </div>
                            </div>

                            {/* Where Are We in Development Section */}
                            <div data-development-section style={{
                                backgroundColor: 'rgba(0, 0, 0, 0.75)',
                                backdropFilter: 'blur(12px)',
                                borderRadius: '16px',
                                padding: 'clamp(30px, 6vw, 60px) clamp(20px, 5vw, 40px)',
                                margin: '60px auto 0',
                                maxWidth: '800px',
                                width: '100%',
                                border: '2px solid rgba(255, 255, 255, 0.3)',
                                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
                                boxSizing: 'border-box',
                                overflowX: 'hidden',
                            }}>
                                <div style={{
                                    fontSize: '22px',
                                    color: '#ff8c00',
                                    fontWeight: '600',
                                    textTransform: 'uppercase',
                                    letterSpacing: '4px',
                                    marginBottom: '30px',
                                    textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                    textAlign: 'center',
                                }}>
                                    WHERE ARE WE IN DEVELOPMENT?
                                </div>
                                <p style={{
                                    fontSize: '16px',
                                    lineHeight: '1.7',
                                    color: 'rgba(255, 255, 255, 0.85)',
                                    textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                    textAlign: 'left',
                                    margin: '0 0 24px 0',
                                }}>
                                    We've progressed from primitive survival to firearms! Crossbows, fire arrows, and now guns help you survive what emerges when the sun sets. Something ancient stirs on this island, echoes of a corruption no one fully understands. Use daylight to farm, trade, and prepare. When darkness falls, you'll need every advantage. The island never sleeps, and neither does its hunger.
                                </p>
                                <div style={{ overflowX: 'auto', maxWidth: '100%' }}>
                                    <table style={{
                                        width: '100%',
                                        fontSize: '14px',
                                        borderCollapse: 'collapse',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                        borderRadius: '8px',
                                        overflow: 'hidden',
                                        backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                    }}>
                                        <thead>
                                            <tr style={{ backgroundColor: 'rgba(0, 0, 0, 0.6)' }}>
                                                <th style={{
                                                    textAlign: 'left',
                                                    padding: '12px 16px',
                                                    color: '#ff8c00',
                                                    fontWeight: 'bold',
                                                    borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
                                                    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                    fontSize: '13px',
                                                    letterSpacing: '1px',
                                                    textTransform: 'uppercase',
                                                }}>
                                                    Feature Group
                                                </th>
                                                <th style={{
                                                    textAlign: 'center',
                                                    padding: '12px 16px',
                                                    color: '#ff8c00',
                                                    fontWeight: 'bold',
                                                    borderBottom: '1px solid rgba(255, 255, 255, 0.2)',
                                                    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                    fontSize: '13px',
                                                    letterSpacing: '1px',
                                                    textTransform: 'uppercase',
                                                }}>
                                                    Status
                                                </th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {[
                                                { name: "🌐 Core Multiplayer & World", status: "100%" },
                                                { name: "🎒 Inventory & Items (Primitive Tech Tree)", status: "100%" },
                                                { name: "⚔️ Melee Combat & Ranged Weapons", status: "100%" },
                                                { name: "🔫 Firearms & Advanced Combat", status: "100%" },
                                                { name: "🍳 Survival & Cooking", status: "100%" },
                                                { name: "🏠 Simple Shelters & Storage", status: "100%" },
                                                { name: "🔐 Authentication", status: "100%" },
                                                { name: "🎤 Voice-Enabled AI Assistant", status: "100%" },
                                                { name: "🌱 Farming Systems", status: "100%" },
                                                { name: "🦌 Hunting & Wildlife", status: "100%" },
                                                { name: "🏗️ Advanced Construction", status: "100%" },
                                                { name: "🍲 Cauldron & Procedural Brewing System", status: "100%" },
                                                { name: "🎣 Simple Fishing", status: "100%" },
                                                { name: "🔧 Tool & Weapon Durability", status: "100%" },
                                                { name: "👥 Social & Team Features", status: "100%" },
                                                { name: "🌙 Day/Night Cycle", status: "100%" },
                                                { name: "👻 Nighttime Threats", status: "100%" },
                                            ].map((feature, index) => (
                                                <tr key={index} style={{ backgroundColor: 'rgba(0, 100, 0, 0.2)', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                                                    <td style={{ padding: '12px 16px', textAlign: 'left', color: 'rgba(255, 255, 255, 0.9)', fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif", fontSize: '14px', fontWeight: '500' }}>
                                                        {feature.name}
                                                    </td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'center', fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif", fontSize: '12px', fontWeight: 'bold' }}>
                                                        <span style={{ backgroundColor: 'rgba(0, 150, 0, 0.8)', color: 'white', padding: '4px 12px', borderRadius: '12px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                            {feature.status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                            {[
                                                { name: "🔑 Social Auth (Steam, Discord, Twitch)", status: "20%" },
                                                { name: "🎨 Graphical Overhaul (Hiring Pixel Artists!)", status: "10%" },
                                                { name: "🤖 Neutral Faction & NPCs", status: "10%" },
                                                { name: "🔬 Advanced Tech Tree", status: "0%" },
                                                { name: "🏙️ City Building", status: "0%" },
                                                { name: "🌍 Beyond The Island", status: "0%" },
                                            ].map((feature, index) => (
                                                <tr key={`planned-${index}`} style={{ backgroundColor: 'rgba(150, 0, 0, 0.2)', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}>
                                                    <td style={{ padding: '12px 16px', textAlign: 'left', color: 'rgba(255, 255, 255, 0.9)', fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif", fontSize: '14px', fontWeight: '500' }}>
                                                        {feature.name}
                                                    </td>
                                                    <td style={{ padding: '12px 16px', textAlign: 'center', fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif", fontSize: '12px', fontWeight: 'bold' }}>
                                                        <span style={{ backgroundColor: 'rgba(100, 100, 100, 0.6)', color: 'rgba(255, 255, 255, 0.8)', padding: '4px 12px', borderRadius: '12px', fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                                                            {feature.status}
                                                        </span>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Big Play Button CTA */}
                                <div style={{
                                    marginTop: '60px',
                                    marginBottom: '80px',
                                    textAlign: 'center',
                                    padding: '0 clamp(20px, 5vw, 40px)',
                                }}>
                                    <button
                                        type="button"
                                        onClick={scrollToTop}
                                        style={{
                                            background: 'linear-gradient(135deg, #ff8c00 0%, #e67c00 50%, #cc6400 100%)',
                                            border: '3px solid rgba(255, 200, 120, 0.6)',
                                            color: 'white',
                                            padding: '20px 56px',
                                            fontSize: 'clamp(20px, 4vw, 28px)',
                                            fontWeight: 800,
                                            textTransform: 'uppercase',
                                            letterSpacing: '3px',
                                            borderRadius: '12px',
                                            cursor: 'pointer',
                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                            textShadow: '2px 2px 4px rgba(0,0,0,0.6)',
                                            boxShadow: '0 6px 24px rgba(255, 140, 0, 0.4), 0 0 20px rgba(255, 140, 0, 0.2)',
                                            transition: 'all 0.25s ease',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.transform = 'translateY(-4px) scale(1.02)';
                                            e.currentTarget.style.boxShadow = '0 10px 32px rgba(255, 140, 0, 0.5), 0 0 30px rgba(255, 140, 0, 0.3)';
                                            e.currentTarget.style.borderColor = 'rgba(255, 220, 150, 0.9)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.transform = 'translateY(0) scale(1)';
                                            e.currentTarget.style.boxShadow = '0 6px 24px rgba(255, 140, 0, 0.4), 0 0 20px rgba(255, 140, 0, 0.2)';
                                            e.currentTarget.style.borderColor = 'rgba(255, 200, 120, 0.6)';
                                        }}
                                    >
                                        {isAuthenticated ? 'Join Game' : 'Start Your Journey'}
                                    </button>
                                </div>
                            </div>

                        </div>
                    </div>
                </div>

                {/* Fixed Back to Top Button */}
                {showBackToTop && (
                    <button
                        onClick={() => {
                            window.scrollTo({
                                top: 0,
                                behavior: 'smooth'
                            });
                        }}
                        style={{
                            position: 'fixed',
                            bottom: '30px',
                            right: '30px',
                            background: 'rgba(255, 140, 0, 0.9)',
                            border: '2px solid rgba(255, 140, 0, 0.6)',
                            color: 'white',
                            padding: '16px',
                            fontSize: '18px',
                            fontWeight: '600',
                            borderRadius: '50%',
                            cursor: 'pointer',
                            transition: 'all 0.3s ease',
                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                            boxShadow: '0 4px 15px rgba(0,0,0,0.3), 0 0 10px rgba(255,140,0,0.4)',
                            zIndex: 1000,
                            width: '60px',
                            height: '60px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(255, 140, 0, 1)';
                            e.currentTarget.style.borderColor = '#ff8c00';
                            e.currentTarget.style.transform = 'translateY(-3px)';
                            e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4), 0 0 15px rgba(255,140,0,0.6)';
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'rgba(255, 140, 0, 0.9)';
                            e.currentTarget.style.borderColor = 'rgba(255, 140, 0, 0.6)';
                            e.currentTarget.style.transform = 'translateY(0)';
                            e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3), 0 0 10px rgba(255,140,0,0.4)';
                        }}
                        title="Back to Top"
                    >
                        ↑
                    </button>
                )}

                {/* Footer */}
                <footer style={{
                    backgroundColor: 'rgba(0, 0, 0, 0.95)',
                    backdropFilter: 'blur(20px)',
                    borderTop: '1px solid rgba(255, 165, 0, 0.3)',
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
                        background: 'linear-gradient(90deg, transparent 0%, rgba(255, 165, 0, 0.6) 50%, transparent 100%)',
                    }} />

                    {/* Decorative symbol at center top */}
                    <div style={{
                        position: 'absolute',
                        top: '-8px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '16px',
                        height: '16px',
                        background: 'linear-gradient(135deg, #ff8c00 0%, #ff6600 100%)',
                        borderRadius: '50%',
                        border: '2px solid rgba(0, 0, 0, 0.95)',
                        boxShadow: '0 0 15px rgba(255, 140, 0, 0.5)',
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
                                src={logo}
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
                                    href="https://martinerlic.com"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{
                                        color: '#ff8c00',
                                        textDecoration: 'none',
                                        transition: 'color 0.2s ease',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.color = '#ffaa33';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.color = '#ff8c00';
                                    }}
                                >
                                    Martin Erlic
                                </a>
                            </p>
                            <p style={{
                                fontSize: '12px',
                                color: 'rgba(255, 255, 255, 0.5)',
                                margin: '10px 0 0 0',
                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                fontFamily: "'Courier New', Consolas, Monaco, monospace",
                            }}>
                                © 2025 Martin Erlic
                            </p>
                        </div>

                        {/* Game Links */}
                        <div style={{
                            textAlign: isMobile ? 'center' : 'left',
                        }}>
                            <h4 style={{
                                fontSize: '14px',
                                color: '#ff8c00',
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
                                    { label: 'ABOUT', action: 'about' },
                                    { label: 'BABUSHKA\'S TOOLS', action: 'tools' },
                                    { label: 'FEATURES', action: 'features' },
                                    { label: 'FAQ', action: 'faq' },
                                    { label: 'LORE', action: 'https://www.babushkabook.com/reader/excerpts/tides-prologue-lagunov', external: true },
                                    { label: 'BLOG', action: '/blog', internal: true },
                                    { label: 'CONTACT', action: 'mailto:martin.erlic@gmail.com', external: true },
                                ].map((link) => (
                                    <li key={link.label} style={{ marginBottom: '12px' }}>
                                        <a
                                            href={link.external ? link.action : '#'}
                                            target={link.external ? '_blank' : undefined}
                                            rel={link.external ? 'noopener noreferrer' : undefined}
                                            onClick={(e) => {
                                                if (link.external) return;
                                                e.preventDefault();
                                                if (link.internal) {
                                                    navigate(link.action);
                                                    // Scroll to top after navigation for internal links
                                                    window.scrollTo(0, 0);
                                                } else {
                                                    const selector = `[data-${link.action}-section]`;
                                                    const section = document.querySelector(selector);
                                                    if (section) {
                                                        // We're on the home page, scroll to the section
                                                        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                    } else {
                                                        // Section not found (probably on blog page), navigate to home first
                                                        navigate('/');
                                                        // Then scroll to the section after a delay
                                                        setTimeout(() => {
                                                            const homeSection = document.querySelector(selector);
                                                            if (homeSection) {
                                                                homeSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                            }
                                                        }, 100);
                                                    }
                                                }
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
                                                e.currentTarget.style.color = '#ff8c00';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                                            }}
                                        >
                                            {link.label}
                                        </a>
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
                                color: '#ff8c00',
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
                                {[
                                    { label: 'PRIVACY POLICY', path: '/privacy' },
                                    { label: 'TERMS OF SERVICE', path: '/terms' },
                                    { label: 'COOKIE DECLARATION', path: '/cookies' },
                                ].map((link) => (
                                    <li key={link.label} style={{ marginBottom: '12px' }}>
                                        <a
                                            href={link.path}
                                            onClick={(e) => {
                                                e.preventDefault();
                                                navigate(link.path);
                                                // Scroll to top after navigation for legal links
                                                window.scrollTo(0, 0);
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
                                                e.currentTarget.style.color = '#ff8c00';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                                            }}
                                        >
                                            {link.label}
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
                                color: '#ff8c00',
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
                                    { name: 'Discord', icon: faDiscord, href: 'https://discord.gg/tUcBzfAYfs' },
                                    { name: 'X (Twitter)', icon: faXTwitter, href: 'https://x.com/metalhorse233' },
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
                                            border: '1px solid rgba(255, 140, 0, 0.4)',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '16px',
                                            textDecoration: 'none',
                                            transition: 'all 0.3s ease',
                                            backgroundColor: 'rgba(255, 140, 0, 0.1)',
                                            color: 'rgba(255, 255, 255, 0.7)',
                                            boxShadow: '0 0 10px rgba(255, 140, 0, 0.2)',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.borderColor = '#ff8c00';
                                            e.currentTarget.style.backgroundColor = 'rgba(255, 140, 0, 0.2)';
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.color = '#ff8c00';
                                            e.currentTarget.style.boxShadow = '0 0 20px rgba(255, 140, 0, 0.5)';
                                        }}
                                        onMouseLeave={(e) => {
                                            e.currentTarget.style.borderColor = 'rgba(255, 140, 0, 0.4)';
                                            e.currentTarget.style.backgroundColor = 'rgba(255, 140, 0, 0.1)';
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                                            e.currentTarget.style.boxShadow = '0 0 10px rgba(255, 140, 0, 0.2)';
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
                                    border: '2px solid rgba(255, 140, 0, 0.6)',
                                    background: 'linear-gradient(135deg, rgba(255, 140, 0, 0.2) 0%, rgba(255, 100, 0, 0.4) 100%)',
                                    color: '#ff8c00',
                                    fontSize: '18px',
                                    fontWeight: 'bold',
                                    cursor: 'pointer',
                                    transition: 'all 0.3s ease',
                                    textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                    boxShadow: '0 4px 15px rgba(0,0,0,0.3), 0 0 10px rgba(255,140,0,0.4)',
                                    fontFamily: "'Courier New', Consolas, Monaco, monospace",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.backgroundColor = 'rgba(255, 140, 0, 0.3)';
                                    e.currentTarget.style.borderColor = 'rgba(255, 140, 0, 0.9)';
                                    e.currentTarget.style.transform = 'translateY(-2px)';
                                    e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.4), 0 0 15px rgba(255,140,0,0.6)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.backgroundColor = 'linear-gradient(135deg, rgba(255, 140, 0, 0.2) 0%, rgba(255, 100, 0, 0.4) 100%)';
                                    e.currentTarget.style.borderColor = 'rgba(255, 140, 0, 0.6)';
                                    e.currentTarget.style.transform = 'translateY(0)';
                                    e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.3), 0 0 10px rgba(255,140,0,0.4)';
                                }}
                                title="Back to Top"
                            >
                                ↑
                            </button>
                        </div>
                    </div>
                </footer>
            </div>
        </>
    );
};

export default LoginScreen;
