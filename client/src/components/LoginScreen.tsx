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
import { useAuth } from '../contexts/AuthContext';
// Import the Player type from generated bindings
import { Player } from '../generated'; // Adjusted path
// Import FontAwesome
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faDiscord, faXTwitter, faGithub } from '@fortawesome/free-brands-svg-icons';
import loginBackground from '../assets/login_background2.png';
import logo from '../assets/logo.png';
import combatLadle from '../assets/combat_ladle.png';
import ocularImplant from '../assets/ocular_implant.png';
import fieldCauldron from '../assets/field_cauldron.png';
import persistentOpenWorld from '../assets/persistent_open_world.png';
import buildGovern from '../assets/build_govern.png';
import chooseCombat from '../assets/choose_combat.png';
import livingEconomy from '../assets/living_economy.png';
import dynamicSeasons from '../assets/dynamic_seasons.png';
import endlessBrewing from '../assets/endless_brewing.png';
// Remove Supabase imports
// import { signInWithEmail, signUpWithEmail, signInWithGoogle, signOut } from '../services/supabase'; 

// Style Constants (Consider moving to a shared file)
const UI_BG_COLOR = 'rgba(40, 40, 60, 0.85)';
const UI_BORDER_COLOR = '#a0a0c0';
const UI_SHADOW = '2px 2px 0px rgba(0,0,0,0.5)';
const UI_FONT_FAMILY = "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif";
const UI_BUTTON_COLOR = '#777';
const UI_BUTTON_DISABLED_COLOR = '#555';
const UI_PAGE_BG_COLOR = '#1a1a2e';

interface LoginScreenProps {
    // Removed username/setUsername props
    handleJoinGame: (usernameToRegister: string | null) => Promise<void>; // Accepts null for existing players, returns Promise to handle errors
    loggedInPlayer: Player | null; // Player data from SpacetimeDB if exists
    connectionError?: string | null; // SpacetimeDB connection error from GameConnectionContext
    storedUsername?: string | null; // Username from localStorage for connection error fallback
    isSpacetimeConnected?: boolean; // Whether SpacetimeDB is connected (used to hide username for connection issues)
}

const LoginScreen: React.FC<LoginScreenProps> = ({
    handleJoinGame,
    loggedInPlayer,
    connectionError,
    storedUsername,
    isSpacetimeConnected = true, // Default to true for backwards compatibility
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

    // Local state for the username input field (only used for new players)
    const [inputUsername, setInputUsername] = useState<string>('');
    const [localError, setLocalError] = useState<string | null>(null);
    const [isMobile, setIsMobile] = useState<boolean>(false);
    const [showBackToTop, setShowBackToTop] = useState<boolean>(false);
    const [backgroundLoaded, setBackgroundLoaded] = useState<boolean>(false);
    const [logoLoaded, setLogoLoaded] = useState<boolean>(false);

    // Ref for username input focus
    const usernameInputRef = useRef<HTMLInputElement>(null);

    // Check for mobile screen size
    useEffect(() => {
        const checkIsMobile = () => {
            setIsMobile(window.innerWidth < 768);
        };
        
        checkIsMobile(); // Check on mount
        window.addEventListener('resize', checkIsMobile);
        return () => window.removeEventListener('resize', checkIsMobile);
    }, []);

    // Check scroll position for back to top button
    useEffect(() => {
        const handleScroll = () => {
            const scrollTop = window.scrollY || document.documentElement.scrollTop;
            setShowBackToTop(scrollTop > 300); // Show after scrolling 300px
        };
        
        window.addEventListener('scroll', handleScroll);
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
                if (loggedInPlayer || storedUsername) {
                    // Existing player: Join directly, pass null for username
                    await handleJoinGame(null);
                } else {
                    // New player: Validate the entered username and join
                    if (validateNewUsername()) {
                        await handleJoinGame(inputUsername);
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
            {/* Add CSS animations */}
            <style>{`
                @keyframes pulse {
                    0% { opacity: 0.4; }
                    100% { opacity: 0.8; }
                }
            `}</style>
        <div style={{
            minHeight: '100vh', // Ensure page is tall enough to scroll
            width: '100%', // Match the background image width exactly
            margin: 0,
            padding: 0,
            backgroundColor: backgroundLoaded ? 'transparent' : '#1a1a2e', // Fallback color while loading
            backgroundImage: backgroundLoaded ? `url(${loginBackground})` : 'none',
            backgroundSize: '100% auto', // Show full width, scale height proportionally
            backgroundPosition: 'center top',
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
                background: 'linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,0) 4%, rgba(0,0,0,0.08) 8%, rgba(0,0,0,0.2) 12%, rgba(0,0,0,0.4) 16%, rgba(0,0,0,0.65) 20%, rgba(0,0,0,0.85) 23%, rgba(0,0,0,0.96) 25%, rgba(0,0,0,1) 27%, rgba(0,0,0,1) 100%)',
                pointerEvents: 'none', // Allow clicks to pass through
                zIndex: 1,
            }} />
            <div style={{
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                alignItems: 'center',
                minHeight: '100vh',
                paddingTop: 'calc(30vh - 10vw)', // Mobile (~375px): ~26vh. Desktop (~1200px): ~18vh
                paddingBottom: '0px',
                textAlign: 'center',
                position: 'relative',
                zIndex: 2, // Ensure content appears above the gradient overlay
            }}>
                {/* Logo */}
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

                <div style={{
                    textAlign: 'center',
                }}>

                    {/* Display based on authentication and player existence */}
                    {authIsLoading ? (
                        <p>Loading...</p>
                    ) : (authError || connectionError) ? (
                        <>
                            <p style={{
                                color: 'red',
                                marginTop: '15px',
                                fontSize: '12px',
                                padding: '8px',
                                backgroundColor: 'rgba(255,0,0,0.1)',
                                borderRadius: '4px',
                                marginBottom: '20px',
                            }}>
                                {connectionError || 'Connection failed. Please ensure you have an internet connection and try again.'}<br />
                                {!connectionError && 'If the problem persists, please try signing out and signing in.'}
                            </p>
                            <div style={{ display: 'flex', flexDirection: 'row', gap: '15px', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
                                <button
                                    onClick={() => window.location.reload()}
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
                                    Try Again
                                </button>
                                <button
                                    onClick={logout}
                                    disabled={authIsLoading}
                                    onMouseEnter={(e) => {
                                        if (!authIsLoading) {
                                            e.currentTarget.style.transform = 'translateY(-2px)';
                                            e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.4), 0 0 20px rgba(139,69,19,0.3)';
                                        }
                                    }}
                                    onMouseLeave={(e) => {
                                        if (!authIsLoading) {
                                            e.currentTarget.style.transform = 'translateY(0)';
                                            e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.4), 0 0 15px rgba(139,69,19,0.4)';
                                        }
                                    }}
                                    style={{
                                        padding: '16px 32px',
                                        border: '2px solid rgba(139, 69, 19, 0.6)',
                                        background: 'linear-gradient(135deg, #8b4513, #654321)',
                                        color: 'white',
                                        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                        fontSize: '16px',
                                        fontWeight: 'bold',
                                        cursor: authIsLoading ? 'not-allowed' : 'pointer',
                                        boxShadow: '0 4px 15px rgba(0,0,0,0.4), 0 0 15px rgba(139,69,19,0.4)',
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
                                    Sign Out
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
                        ) : connectionError ? (
                            // Connection error without stored username: Show generic authenticated message
                            <p style={{
                                marginBottom: '20px',
                                fontSize: '14px'
                            }}>
                                Authenticated - Reconnect to game
                            </p>
                        ) : (
                            // New Player: Show username input ONLY if no authError, no connectionError, no localError
                            // AND SpacetimeDB is connected AND no stored username (to ensure this is genuinely a new user)
                            !authError && !connectionError && !localError && isSpacetimeConnected && !storedUsername ? (
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
                                // Show appropriate error message when authenticated but there's an error
                                // <p style={{
                                //     marginBottom: '20px',
                                //     fontSize: '14px',
                                //     color: 'red'
                                // }}>
                                //     Unable to access game servers. Please try refreshing the page.
                                // </p>
                                <></>
                            )
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
                                    if (!authError && (!connectionError || storedUsername) && !localError) {
                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                        e.currentTarget.style.boxShadow = '0 8px 25px rgba(0,0,0,0.4), 0 0 20px rgba(255,165,0,0.3)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!authError && (!connectionError || storedUsername) && !localError) {
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.boxShadow = '0 4px 15px rgba(0,0,0,0.4), 0 0 15px rgba(255,140,0,0.4)';
                                    }
                                }}
                                style={{
                                    padding: '16px 32px',
                                    border: '2px solid rgba(255, 165, 0, 0.6)',
                                    backgroundColor: (authError || (connectionError && !storedUsername) || localError) ? 'rgba(100, 50, 50, 0.6)' : 'linear-gradient(135deg, rgba(255, 140, 0, 0.9), rgba(200, 100, 0, 0.9))',
                                    background: (authError || (connectionError && !storedUsername) || localError) ? 'rgba(100, 50, 50, 0.6)' : 'linear-gradient(135deg, #ff8c00, #cc6400)',
                                    color: (authError || (connectionError && !storedUsername) || localError) ? '#ccc' : 'white',
                                    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                    fontSize: '16px',
                                    fontWeight: 'bold',
                                    cursor: (authError || (connectionError && !storedUsername) || localError) ? 'not-allowed' : 'pointer',
                                    boxShadow: (authError || (connectionError && !storedUsername) || localError) ? '2px 2px 6px rgba(0,0,0,0.4)' : '0 4px 15px rgba(0,0,0,0.4), 0 0 15px rgba(255,140,0,0.4)',
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
                                {isAuthenticated ? 'Join Game' : 'Start Your Journey'}
                            </button>

                            {/* Version Text with Learn More */}
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '15px',
                                marginTop: '15px',
                            }}>
                                <span style={{
                                    fontSize: '13px',
                                    color: 'rgba(255, 255, 255, 0.9)',
                                    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                    textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                    letterSpacing: '0.5px',
                                }}>
                                    Early Access v0.53
                                </span>
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        const contentSection = document.querySelector('[data-content-section]');
                                        if (contentSection) {
                                            contentSection.scrollIntoView({
                                                behavior: 'smooth',
                                                block: 'start'
                                            });
                                        } else {
                                            window.scrollTo({
                                                top: window.innerHeight * 0.9,
                                                behavior: 'smooth'
                                            });
                                        }
                                    }}
                                    style={{
                                        background: 'none',
                                        border: '1px solid rgba(255, 255, 255, 0.4)',
                                        color: 'rgba(255, 255, 255, 0.9)',
                                        padding: '4px 8px',
                                        fontSize: '11px',
                                        borderRadius: '12px',
                                        cursor: 'pointer',
                                        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                        transition: 'all 0.2s ease',
                                        letterSpacing: '0.3px',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.1)';
                                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.6)';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = 'transparent';
                                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.4)';
                                    }}
                                >
                                    learn more
                                </button>
                            </div>
                        </form>
                    )}

                    {/* Show error state with Refresh button for connection-related localErrors */}
                    {!authIsLoading && !authError && localError && localError.includes('Connection error') && (
                        <>
                            <p style={{
                                color: 'red',
                                marginTop: '15px',
                                fontSize: '12px',
                                padding: '8px',
                                backgroundColor: 'rgba(255,0,0,0.1)',
                                borderRadius: '4px',
                                marginBottom: '20px',
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
                    {localError && !authError && !localError.includes('Connection error') && (
                        <p style={{
                            color: 'red',
                            marginTop: '0px',
                            marginBottom: '15px',
                            fontSize: '12px',
                            padding: '8px',
                            backgroundColor: 'rgba(255,0,0,0.1)',
                            borderRadius: '4px',
                        }}>
                            {localError}
                        </p>
                    )}

                    {/* Logout Section (Only if authenticated and no authError and no connectionError) */}
                    {isAuthenticated && !authError && !connectionError && (
                        <div style={{
                            marginTop: '20px',
                            borderTop: '1px solid rgba(255, 255, 255, 0.1)',
                            paddingTop: '20px'
                        }}>
                            {userProfile && (
                                <span style={{
                                    fontSize: '10px',
                                    color: '#ccc',
                                    display: 'block',
                                    marginBottom: '8px'
                                }}>
                                    ({userProfile.email || userProfile.userId})
                                </span>
                            )}
                            <button
                                onClick={logout}
                                disabled={authIsLoading}
                                style={{
                                    padding: '5px 10px',
                                    fontSize: '10px',
                                    background: '#444',
                                    color: 'white',
                                    border: '1px solid rgba(255, 255, 255, 0.1)',
                                    cursor: authIsLoading ? 'not-allowed' : 'pointer',
                                    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                    borderRadius: '2px',
                                }}
                            >
                                Sign Out
                            </button>
                        </div>
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
                                    Where Rust's intense survival meets Blazing Beaks' quirky combat, all wrapped in Stardew Valley's
                                    cozy farming vibes. Survive as a resourceful babushka in this top-down multiplayer experience where
                                    every meal matters and every trade counts. Start with basic gear, hunt wild animals, grow crops,
                                    and brew nourishing soups that keep you alive through harsh winters. Build from simple shelters to
                                    thriving homesteads, domesticate livestock, and establish trading networks with neighboring clans
                                    across one massive persistent world.
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
                                    marginBottom: '60px',
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

                                {/* Tools Grid */}
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 'clamp(20px, 4vw, 40px)',
                                    maxWidth: '700px',
                                    margin: '0 auto',
                                }}>
                                    {[
                                        {
                                            title: "Combat Ladle",
                                            description: "Your trusty kitchen ladle doubles as both a weapon and cooking tool. Use it to stir soups and broths - better ladles create superior broths with enhanced stat bonuses and special effects. Upgrade it with tungsten plating for extra damage or add a retractable blade for surprise attacks.",
                                            icon: combatLadle,
                                        },
                                        {
                                            title: "Neuroveil Ocular Implant",
                                            description: "Miraculously intact after the shipwreck, this cutting-edge device was designed in Gred by Rozhkov Neuroscience. Powered by bioelectrical stimulation, it never runs out of batteries. Scan your environment for resources, receive tactical advice, detect threats, and unlock hidden secrets.",
                                            icon: ocularImplant,
                                        },
                                        {
                                            title: "Cerametal Field Cauldron",
                                            description: "Your Scavenger-grade Cerametal Field Cauldron, Mk.I is where you actually brew life-sustaining broths and sterilize contaminated water. Must be placed on a campfire to function, but can cook much faster when positioned over natural geysers and steam vents you discover in the world.",
                                            icon: fieldCauldron,
                                        },
                                    ].map((feature, index) => (
                                        <div key={index} style={{
                                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                            border: '1px solid rgba(255, 255, 255, 0.2)',
                                            borderRadius: '12px',
                                            padding: 'clamp(20px, 4vw, 32px)', // Responsive padding for tools section cards
                                            transition: 'all 0.3s ease',
                                            width: '100%',
                                            boxSizing: 'border-box',
                                            overflowX: 'hidden',
                                            wordWrap: 'break-word',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            textAlign: 'center',
                                        }}>
                                            {/* Feature Icon */}
                                            <img
                                                src={feature.icon}
                                                alt={feature.title}
                                                style={{
                                                    width: '80px',
                                                    height: '80px',
                                                    objectFit: 'contain',
                                                    marginBottom: '24px',
                                                    filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))',
                                                }}
                                                onError={(e) => {
                                                    // Fallback if image fails to load
                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                            />

                                            {/* Feature Title */}
                                            <h3 style={{
                                                fontSize: '22px',
                                                color: '#ff8c00',
                                                marginBottom: '16px',
                                                fontWeight: 'bold',
                                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                letterSpacing: '1px',
                                                textAlign: 'center',
                                                lineHeight: '1.2',
                                            }}>
                                                {feature.title}
                                            </h3>

                                            {/* Feature Description */}
                                            <p style={{
                                                fontSize: '16px',
                                                lineHeight: '1.7',
                                                color: 'rgba(255, 255, 255, 0.85)',
                                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                textAlign: 'center',
                                                margin: '0',
                                            }}>
                                                {feature.description}
                                            </p>
                                        </div>
                                    ))}
                                </div>
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
                                    marginBottom: '60px',
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

                                {/* Features Grid */}
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 'clamp(20px, 4vw, 40px)',
                                    maxWidth: '700px',
                                    margin: '0 auto',
                                }}>
                                    {[
                                        {
                                            title: "Persistent Open World",
                                            description: "Explore one massive, persistent world where your actions matter. Every structure built, every tree chopped, and every alliance forged remains forever. The world evolves even when you're offline as other players continue shaping the landscape.",
                                            icon: persistentOpenWorld,
                                        },
                                        {
                                            title: "Build & Govern",
                                            description: "Start with simple shelters and grow into sprawling bases. Found towns, establish trade routes, and build defensive fortifications. Start babushka clans and elect Pra Matrons to govern large swathes of land through regional politics.",
                                            icon: buildGovern,
                                        },
                                        {
                                            title: "Choose Your Combat",
                                            description: "Enjoy optional PvP with personal flags and dedicated PvP zones. Toggle your combat preference or seek out dangerous regions for high-risk, high-reward encounters. Peace-loving babushkas can trade and build without fear.",
                                            icon: chooseCombat,
                                        },
                                        {
                                            title: "Living Economy",
                                            description: "Master a complex economy system with player-driven marketplaces and auction houses. Corner markets on rare materials, establish trading empires, and become the wealthiest babushka in the land through shrewd business dealings.",
                                            icon: livingEconomy,
                                        },
                                        {
                                            title: "Dynamic Seasons",
                                            description: "Experience realistic weather patterns and seasonal changes with a dynamic cloud system. Crops grow differently in each season, harsh winters test your food stores, and spring rains bring abundant harvests.",
                                            icon: dynamicSeasons,
                                        },
                                        {
                                            title: "Endless Brewing",
                                            description: "Combine plant materials and foods to create unique broths with endless procedural recipes. Discover rare ingredient combinations that produce powerful stat bonuses, unique effects, and legendary rarities sought by all survivors.",
                                            icon: endlessBrewing,
                                        },
                                    ].map((feature, index) => (
                                        <div key={index} style={{
                                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                            border: '1px solid rgba(255, 255, 255, 0.2)',
                                            borderRadius: '12px',
                                            padding: 'clamp(20px, 4vw, 32px)', // Responsive padding for features section cards
                                            transition: 'all 0.3s ease',
                                            width: '100%',
                                            boxSizing: 'border-box',
                                            overflowX: 'hidden',
                                            wordWrap: 'break-word',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            alignItems: 'center',
                                            textAlign: 'center',
                                        }}>
                                            {/* Feature Icon */}
                                            <img
                                                src={feature.icon}
                                                alt={feature.title}
                                                style={{
                                                    width: '80px',
                                                    height: '80px',
                                                    objectFit: 'contain',
                                                    marginBottom: '24px',
                                                    filter: 'drop-shadow(0 4px 8px rgba(0,0,0,0.4))',
                                                }}
                                                onError={(e) => {
                                                    // Fallback if image fails to load
                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                            />

                                            {/* Feature Title */}
                                            <h3 style={{
                                                fontSize: '20px',
                                                color: '#ff8c00',
                                                marginBottom: '16px',
                                                fontWeight: 'bold',
                                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                letterSpacing: '1px',
                                                textAlign: 'center',
                                                lineHeight: '1.2',
                                            }}>
                                                {feature.title}
                                            </h3>

                                            {/* Feature Description */}
                                            <p style={{
                                                fontSize: '16px',
                                                lineHeight: '1.7',
                                                color: 'rgba(255, 255, 255, 0.85)',
                                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                textAlign: 'center',
                                                margin: '0',
                                            }}>
                                                {feature.description}
                                            </p>
                                        </div>
                                    ))}
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
                                            answer: "A top-down multiplayer survival game where resourceful babushkas build thriving homesteads from nothing. Master the art of cooking life-saving meals, establish profitable trade routes, defend your territory with crossbows and cunning, and grow from a humble survivor into a powerful clan leader in one massive persistent world."
                                        },
                                        {
                                            question: "HOW DO I START SURVIVING?",
                                            answer: "You begin with basic survival gear and your grandmother's wisdom. Hunt wild animals for meat and pelts, gather plant fibers to weave into clothing and shelter materials, collect wood and stone to build your first camp fire. Cook hearty meals to stay fed and warm through the changing seasons."
                                        },
                                        {
                                            question: "WHAT'S SO SPECIAL ABOUT BREWING?",
                                            answer: "Every recipe matters for survival! Brew healing broths from gathered herbs, create nutritious soups from farmed vegetables, ferment preserves for long winters, and craft warming drinks for harsh climates. Master brewers become invaluable clan members whose recipes can mean the difference between thriving and starving."
                                        },
                                        {
                                            question: "CAN I FARM AND RAISE ANIMALS?",
                                            answer: "Absolutely! Plant and tend crops from seeds you've gathered or traded for. Domesticate wild animals like chickens, goats, and pigs. Build fences to protect your livestock from predators and rival players. Your farm becomes the foundation of both your survival and your trading empire."
                                        },
                                        {
                                            question: "HOW DOES BUILDING AND TERRITORY WORK?",
                                            answer: "Start with simple shelters made from plant fiber and wood, then expand into proper homesteads with kitchens, storage, workshops, and defensive walls. Claim territory through use and defense—what you can build and protect becomes yours to develop and trade from."
                                        },
                                        {
                                            question: "HOW COMPLEX IS THE ECONOMY?",
                                            answer: "Trade drives everything! Start by bartering surplus crops and crafted goods with neighbors. As your operation grows, establish supply chains with distant clans, corner markets on rare ingredients, and become a trading mogul. Seasonal changes, supply shortages, and player conflicts create constantly shifting opportunities."
                                        },
                                        {
                                            question: "WHERE ARE WE IN DEVELOPMENT?",
                                            answer: (
                                                <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
                                                    <p style={{
                                                        fontSize: '16px',
                                                        lineHeight: '1.7',
                                                        color: 'rgba(255, 255, 255, 0.85)',
                                                        textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                        textAlign: 'center',
                                                        margin: '0',
                                                    }}>
                                                        We're currently in the primitive stage of our tech tree—plenty of broth, but the bullets are still to come! Right now it's crossbows, fire arrows, and good old-fashioned clan warfare. We're building our foundation of survival, farming, cooking, and trading before advancing to more complex technologies. The persistent world is live and growing!
                                                    </p>

                                                    <div style={{
                                                        overflowX: 'auto',
                                                        maxWidth: '100%',
                                                    }}>
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
                                                                <tr style={{
                                                                    backgroundColor: 'rgba(0, 0, 0, 0.6)',
                                                                }}>
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
                                                                {/* Completed Feature Groups */}
                                                                {[
                                                                    { name: "🌐 Core Multiplayer & World", status: "100%" },
                                                                    { name: "🎒 Inventory & Items", status: "100%" },
                                                                    { name: "⚔️ Combat & Weapons", status: "100%" },
                                                                    { name: "🍳 Survival & Cooking", status: "100%" },
                                                                    { name: "🏠 Simple Shelters & Storage", status: "100%" },
                                                                    { name: "🔐 Authentication", status: "100%" },
                                                                ].map((feature, index) => (
                                                                    <tr key={index} style={{
                                                                        backgroundColor: 'rgba(0, 100, 0, 0.2)',
                                                                        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                                                                    }}>
                                                                        <td style={{
                                                                            padding: '12px 16px',
                                                                            textAlign: 'left',
                                                                            color: 'rgba(255, 255, 255, 0.9)',
                                                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                                            fontSize: '14px',
                                                                            fontWeight: '500',
                                                                        }}>
                                                                            {feature.name}
                                                                        </td>
                                                                        <td style={{
                                                                            padding: '12px 16px',
                                                                            textAlign: 'center',
                                                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                                            fontSize: '12px',
                                                                            fontWeight: 'bold',
                                                                        }}>
                                                                            <span style={{
                                                                                backgroundColor: 'rgba(0, 150, 0, 0.8)',
                                                                                color: 'white',
                                                                                padding: '4px 12px',
                                                                                borderRadius: '12px',
                                                                                fontSize: '11px',
                                                                                textTransform: 'uppercase',
                                                                                letterSpacing: '0.5px',
                                                                            }}>
                                                                                ✓ {feature.status}
                                                                            </span>
                                                                        </td>
                                                                </tr>
                                                                ))}

                                                                {/* In Progress Features */}
                                                                {[
                                                                    { name: "🔧 Tool & Weapon Durability", status: "60%" },
                                                                    { name: "👥 Social & Team Features", status: "40%" },
                                                                    { name: "🌱 Farming Systems", status: "35%" },
                                                                    { name: "🤖 AI & NPCs", status: "30%" },
                                                                ].map((feature, index) => (
                                                                    <tr key={index} style={{
                                                                        backgroundColor: 'rgba(255, 165, 0, 0.15)',
                                                                        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                                                                    }}>
                                                                        <td style={{
                                                                            padding: '12px 16px',
                                                                            textAlign: 'left',
                                                                            color: 'rgba(255, 255, 255, 0.9)',
                                                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                                            fontSize: '14px',
                                                                            fontWeight: '500',
                                                                        }}>
                                                                            {feature.name}
                                                                        </td>
                                                                        <td style={{
                                                                            padding: '12px 16px',
                                                                            textAlign: 'center',
                                                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                                            fontSize: '12px',
                                                                            fontWeight: 'bold',
                                                                        }}>
                                                                            <span style={{
                                                                                backgroundColor: 'rgba(255, 140, 0, 0.8)',
                                                                                color: 'white',
                                                                                padding: '4px 12px',
                                                                                borderRadius: '12px',
                                                                                fontSize: '11px',
                                                                                textTransform: 'uppercase',
                                                                                letterSpacing: '0.5px',
                                                                            }}>
                                                                                ⚡ {feature.status}
                                                                            </span>
                                                                        </td>
                                                                </tr>
                                                                ))}

                                                                {/* Planned Features */}
                                                                {[
                                                                    { name: "🌍 Advanced World Generation", status: "20%" },
                                                                    { name: "🏗️ Advanced Construction", status: "10%" },
                                                                    { name: "🦌 Hunting & Wildlife", status: "10%" },
                                                                    { name: "🎣 Fishing & Aquaculture", status: "10%" },
                                                                    { name: "🔫 Firearms & Advanced Combat", status: "10%" },
                                                                ].map((feature, index) => (
                                                                    <tr key={index} style={{
                                                                        backgroundColor: 'rgba(150, 0, 0, 0.2)',
                                                                        borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
                                                                    }}>
                                                                        <td style={{
                                                                            padding: '12px 16px',
                                                                            textAlign: 'left',
                                                                            color: 'rgba(255, 255, 255, 0.9)',
                                                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                                            fontSize: '14px',
                                                                            fontWeight: '500',
                                                                        }}>
                                                                            {feature.name}
                                                                        </td>
                                                                        <td style={{
                                                                            padding: '12px 16px',
                                                                            textAlign: 'center',
                                                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                                                            fontSize: '12px',
                                                                            fontWeight: 'bold',
                                                                        }}>
                                                                            <span style={{
                                                                                backgroundColor: 'rgba(100, 100, 100, 0.6)',
                                                                                color: 'rgba(255, 255, 255, 0.8)',
                                                                                padding: '4px 12px',
                                                                                borderRadius: '12px',
                                                                                fontSize: '11px',
                                                                                textTransform: 'uppercase',
                                                                                letterSpacing: '0.5px',
                                                                            }}>
                                                                                📋 {feature.status}
                                                                            </span>
                                                                        </td>
                                                                </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                            )
                                        },
                                        {
                                            question: "WHAT'S THE LONG-TERM VISION?",
                                            answer: "One massive persistent world where thousands of players shape a living economy and evolving civilizations. We're committed to delivering on our promise of deep survival mechanics, complex brewing systems, and emergent gameplay that grows more interesting as our community builds together season after season."
                                        }
                                    ].map((faq, index) => (
                                        <div key={index} style={{
                                            backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                            border: '1px solid rgba(255, 255, 255, 0.2)',
                                            borderRadius: '12px',
                                            padding: 'clamp(20px, 4vw, 32px)', // Responsive padding for FAQ cards
                                            transition: 'all 0.3s ease',
                                            width: '100%',
                                            boxSizing: 'border-box',
                                            overflowX: 'hidden',
                                            wordWrap: 'break-word',
                                        }}>
                                            <h3 style={{
                                                fontSize: '18px',
                                                color: '#ff8c00',
                                                marginBottom: '16px',
                                                fontWeight: 'bold',
                                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                letterSpacing: '1px',
                                                textAlign: 'center',
                                            }}>
                                                {faq.question}
                                            </h3>
                                            <div style={{
                                                fontSize: '16px',
                                                lineHeight: '1.7',
                                                color: 'rgba(255, 255, 255, 0.85)',
                                                textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                                textAlign: 'center',
                                                margin: '0',
                                            }}>
                                                {faq.answer}
                                            </div>
                                        </div>
                                    ))}
                                </div>
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
                padding: 'clamp(30px, 6vw, 60px) clamp(20px, 5vw, 40px) clamp(20px, 4vw, 40px) clamp(20px, 5vw, 40px)', // Responsive footer padding
                position: 'relative',
                zIndex: 3,
                width: '100%',
                boxSizing: 'border-box',
                overflowX: 'hidden',
                contentVisibility: 'auto',
                containIntrinsicSize: '1200px 400px',
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
                    backgroundColor: 'rgba(0, 0, 0, 0.95)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                }}>
                    <div style={{
                        width: '8px',
                        height: '8px',
                        border: '1px solid rgba(255, 165, 0, 0.6)',
                        borderRadius: '50%',
                        transform: 'rotate(45deg)',
                    }} />
                </div>

                <div style={{
                    maxWidth: '1200px',
                    margin: '0 auto',
                    display: isMobile ? 'flex' : 'grid',
                    flexDirection: isMobile ? 'column' : undefined,
                    gridTemplateColumns: isMobile ? undefined : 'repeat(auto-fit, minmax(200px, 1fr))',
                    gap: '40px',
                    alignItems: 'start',
                }}>
                    {/* Logo Section */}
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'flex-start',
                    }}>

                        <img
                            src={logo}
                            alt="Broth & Bullets Logo"
                            style={{
                                width: '160px',
                                height: 'auto',
                                marginBottom: '20px',
                                filter: 'drop-shadow(0 0 10px rgba(0,0,0,0.5))',
                            }}
                        />
                        <p style={{
                            fontSize: '13px',
                            color: 'rgba(255, 255, 255, 0.7)',
                            lineHeight: '1.6',
                            margin: '0',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                        }}>
                            Broth & Bullets is developed by{' '}
                            <a
                                href="https://seloolive.com/products/authentic-croatian-olive-oil?variant=40790542549035#reviews"
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
                                Selo Oils LLC
                            </a>
                        </p>
                        <p style={{
                            fontSize: '12px',
                            color: 'rgba(255, 255, 255, 0.5)',
                            margin: '10px 0 0 0',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                        }}>
                            © 2025 Selo Oils LLC
                        </p>
                    </div>

                    {/* Game Links */}
                    <div>
                        <h4 style={{
                            fontSize: '14px',
                            color: '#ff8c00',
                            fontWeight: '600',
                            textTransform: 'uppercase',
                            letterSpacing: '2px',
                            marginBottom: '20px',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                        }}>
                            GAME
                        </h4>
                        <ul style={{
                            listStyle: 'none',
                            padding: 0,
                            margin: 0,
                        }}>
                            {['ABOUT', 'BABUSHKA\'S TOOLS', 'FEATURES', 'FAQ', 'LORE', 'BLOG', 'CONTACT'].map((link) => (
                                <li key={link} style={{ marginBottom: '12px' }}>
                                    <a
                                        href="#"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            if (link === 'ABOUT') {
                                                const aboutSection = document.querySelector('[data-about-section]');
                                                if (aboutSection) {
                                                    aboutSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                }
                                            } else if (link === 'BABUSHKA\'S TOOLS') {
                                                const loadoutSection = document.querySelector('[data-tools-section]');
                                                if (loadoutSection) {
                                                    loadoutSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                }
                                            } else if (link === 'FEATURES') {
                                                const featuresSection = document.querySelector('[data-features-section]');
                                                if (featuresSection) {
                                                    featuresSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                }
                                            } else if (link === 'FAQ') {
                                                const faqSection = document.querySelector('[data-faq-section]');
                                                if (faqSection) {
                                                    faqSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                }
                                            } else if (link === 'LORE') {
                                                window.open('https://www.babushkabook.com/', '_blank');
                                            } else if (link === 'CONTACT') {
                                                window.location.href = 'mailto:martin@selooils.com';
                                            }
                                        }}
                                        style={{
                                            color: 'rgba(255, 255, 255, 0.7)',
                                            textDecoration: 'none',
                                            fontSize: '13px',
                                            transition: 'color 0.2s ease',
                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.color = '#ff8c00';
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

                    {/* Legal Links */}
                    <div>
                        <h4 style={{
                            fontSize: '14px',
                            color: '#ff8c00',
                            fontWeight: '600',
                            textTransform: 'uppercase',
                            letterSpacing: '2px',
                            marginBottom: '20px',
                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
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
                                            fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
                                            textShadow: '1px 1px 2px rgba(0,0,0,0.8)',
                                        }}
                                        onMouseEnter={(e) => {
                                            e.currentTarget.style.color = '#ff8c00';
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

                    {/* Social Links & Back to Top */}
                    <div style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: isMobile ? 'center' : 'flex-end',
                    }}>
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
                                    onClick={(e) => e.preventDefault()}
                                    title={social.name}
                                    style={{
                                        width: '40px',
                                        height: '40px',
                                        borderRadius: '50%',
                                        border: '1px solid rgba(255, 255, 255, 0.2)',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        fontSize: '16px',
                                        textDecoration: 'none',
                                        transition: 'all 0.3s ease',
                                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                                        color: 'rgba(255, 255, 255, 0.7)',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.borderColor = '#ff8c00';
                                        e.currentTarget.style.backgroundColor = 'rgba(255, 140, 0, 0.1)';
                                        e.currentTarget.style.transform = 'translateY(-2px)';
                                        e.currentTarget.style.color = '#ff8c00';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.2)';
                                        e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.05)';
                                        e.currentTarget.style.transform = 'translateY(0)';
                                        e.currentTarget.style.color = 'rgba(255, 255, 255, 0.7)';
                                    }}
                                >
                                    <FontAwesomeIcon icon={social.icon} />
                                </a>
                            ))}
                        </div>


                    </div>
                </div>
            </footer>
        </div>
        </>
    );
};

export default LoginScreen; 