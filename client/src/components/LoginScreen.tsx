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
import githubLogo from '../../public/github.png'; // Adjust path as needed
import { useAuth } from '../contexts/AuthContext';
// Import the Player type from generated bindings
import { Player } from '../generated'; // Adjusted path
// Remove Supabase imports
// import { signInWithEmail, signUpWithEmail, signInWithGoogle, signOut } from '../services/supabase'; 

// Style Constants (Consider moving to a shared file)
const UI_BG_COLOR = 'rgba(40, 40, 60, 0.85)';
const UI_BORDER_COLOR = '#a0a0c0';
const UI_SHADOW = '2px 2px 0px rgba(0,0,0,0.5)';
const UI_FONT_FAMILY = '"Press Start 2P", cursive';
const UI_BUTTON_COLOR = '#777';
const UI_BUTTON_DISABLED_COLOR = '#555';

interface LoginScreenProps {
    // Removed username/setUsername props
    handleJoinGame: (usernameToRegister: string | null) => void; // Accepts null for existing players
    loggedInPlayer: Player | null; // Player data from SpacetimeDB if exists
}

const LoginScreen: React.FC<LoginScreenProps> = ({
    handleJoinGame, 
    loggedInPlayer,
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
    
    // Ref for username input focus
    const usernameInputRef = useRef<HTMLInputElement>(null);

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
            
            if (loggedInPlayer) {
                // Existing player: Join directly, pass null for username
                 handleJoinGame(null); 
            } else {
                // New player: Validate the entered username and join
                if (validateNewUsername()) {
                    handleJoinGame(inputUsername);
                }
            }
        }
    };

    // Handle Enter key press in the input field (only applicable for new players)
    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !authIsLoading && isAuthenticated && !loggedInPlayer) {
            handleSubmit(event as unknown as React.FormEvent);
        }
    };

    return (
        <div style={{ 
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '100vh',
            width: '100%',
            fontFamily: UI_FONT_FAMILY,
        }}>
            <div style={{ 
                backgroundColor: UI_BG_COLOR,
                color: 'white',
                padding: '40px',
                borderRadius: '4px',
                border: `1px solid ${UI_BORDER_COLOR}`,
                boxShadow: UI_SHADOW,
                textAlign: 'center',
                minWidth: '400px',
            }}>
                <img
                    src={githubLogo}
                    alt="Vibe Coding Logo"
                    style={{
                        width: '240px',
                        height: 'auto',
                        marginBottom: '25px',
                    }}
                />
                <h2 style={{ marginBottom: '30px', fontWeight: 'normal' }}>2D Survival Multiplayer</h2>
                
                {/* Display based on authentication and player existence */}
                {authIsLoading ? (
                    <p>Loading...</p>
                ) : authError ? (
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
                            {authError}<br />
                            Please try signing out and signing in again.
                        </p>
                        <button
                            onClick={logout}
                            disabled={authIsLoading} // Though authIsLoading is false here, keep for consistency
                            style={{
                                padding: '10px 20px',
                                border: `1px solid ${UI_BORDER_COLOR}`,
                                backgroundColor: UI_BUTTON_COLOR,
                                color: 'white',
                                fontFamily: UI_FONT_FAMILY,
                                fontSize: '14px',
                                cursor: 'pointer',
                                boxShadow: UI_SHADOW,
                                width: '100%',
                                marginBottom: '15px',
                            }}
                        >
                            Sign Out
                        </button>
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
                    ) : (
                        // New Player: Show username input
                        <input
                            ref={usernameInputRef}
                            type="text"
                            placeholder="Choose Your Username"
                            value={inputUsername}
                            onChange={(e) => setInputUsername(e.target.value)}
                            onKeyDown={handleKeyDown}
                            // disabled is implicitly handled by not rendering if authError
                            style={{
                                padding: '10px',
                                marginBottom: '15px',
                                border: `1px solid ${UI_BORDER_COLOR}`,
                                backgroundColor: '#333',
                                color: 'white',
                                fontFamily: UI_FONT_FAMILY,
                                fontSize: '14px',
                                display: 'block',
                                width: 'calc(100% - 22px)',
                                textAlign: 'center',
                            }}
                        />
                    )
                ) : null /* Not loading, no error, not authenticated: Button below will handle Sign In */}

                {/* Render Login/Join button only if not loading and no authError */}
                {!authIsLoading && !authError && (
                    <form onSubmit={handleSubmit}>
                        <button
                            type="submit"
                            // disabled logic from previous step is still relevant if this form is shown
                            disabled={isAuthenticated && !!authError} //This condition is less likely to be met now due to parent check
                            style={{
                                padding: '10px 20px',
                                border: `1px solid ${UI_BORDER_COLOR}`,
                                backgroundColor: (isAuthenticated && !!authError) ? UI_BUTTON_DISABLED_COLOR : UI_BUTTON_COLOR,
                                color: (isAuthenticated && !!authError) ? '#aaa' : 'white',
                                fontFamily: UI_FONT_FAMILY,
                                fontSize: '14px',
                                cursor: (isAuthenticated && !!authError) ? 'not-allowed' : 'pointer',
                                boxShadow: UI_SHADOW,
                                width: '100%',
                                marginBottom: '15px',
                            }}
                        >
                            {isAuthenticated ? 'Join Game' : 'Sign In / Sign Up'}
                        </button>
                    </form>
                )}
                
                {/* Local Error Messages (e.g., for username validation) - show if not authError */}
                {localError && !authError && (
                    <p style={{
                        color: 'red',
                        marginTop: '15px',
                        fontSize: '12px',
                        padding: '8px',
                        backgroundColor: 'rgba(255,0,0,0.1)',
                        borderRadius: '4px',
                    }}>
                        {localError}
                    </p>
                )}
                
                {/* Logout Section (Only if authenticated and no authError) */}
                {isAuthenticated && !authError && (
                    <div style={{ marginTop: '20px' }}>
                        {userProfile && (
                            <span style={{ fontSize: '10px', color: '#ccc', display: 'block', marginBottom: '8px' }}>
                                (ID: {userProfile.userId})
                            </span>
                        )}
                        <button
                            onClick={logout}
                            disabled={authIsLoading} // authIsLoading is false here, but good for consistency
                            style={{
                                padding: '5px 10px',
                                fontSize: '10px',
                                background: '#444',
                                color: 'white',
                                border: 'none',
                                cursor: authIsLoading ? 'not-allowed' : 'pointer',
                                fontFamily: UI_FONT_FAMILY,
                            }}
                        >
                            Sign Out
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default LoginScreen; 