/**
 * LoginScreen.tsx
 * 
 * Displays the initial welcome/login screen.
 * Handles:
 *  - Displaying game title and logo.
 *  - Triggering OpenAuth OIDC login flow.
 *  - Input field for username (for game join, not authentication).
 *  - Displaying loading states and errors.
 *  - Handling logout.
 */

import React, { useRef, useEffect, useState } from 'react';
import githubLogo from '../../public/github.png'; // Adjust path as needed
import { useAuth } from '../contexts/AuthContext';
// Remove Supabase imports
// import { signInWithEmail, signUpWithEmail, signInWithGoogle, signOut } from '../services/supabase'; 

// Style Constants (Consider moving to a shared file)
const UI_BG_COLOR = 'rgba(40, 40, 60, 0.85)';
const UI_BORDER_COLOR = '#a0a0c0';
const UI_SHADOW = '2px 2px 0px rgba(0,0,0,0.5)';
const UI_FONT_FAMILY = '"Press Start 2P", cursive';
const UI_BUTTON_COLOR = '#777';
const UI_BUTTON_HOVER_COLOR = '#8a8a9a'; 
const UI_BUTTON_DISABLED_COLOR = '#555';

interface LoginScreenProps {
    username: string;
    setUsername: (value: string) => void;
    handleLogin: () => void; // Renamed from handleRegister, now used for joining game after auth
    // isLoading and error props likely removed as AuthContext handles them
    // isLoading: boolean; 
    // error: string | null;
}

const LoginScreen: React.FC<LoginScreenProps> = ({
    username,
    setUsername,
    handleLogin, // This prop is now for joining the game *after* authentication
}) => {
    // Get OpenAuth state and functions
    const { 
        userProfile, // Contains { userId } after successful login 
        isAuthenticated, 
        isLoading: authIsLoading, // Renamed to avoid conflict
        authError, 
        loginRedirect, 
        logout 
    } = useAuth();
    
    // Local state for UI feedback, potentially remove if not needed
    const [localError, setLocalError] = useState<string | null>(null);
    
    // Ref for username input focus
    const usernameInputRef = useRef<HTMLInputElement>(null);

    // Autofocus username field if authenticated
    useEffect(() => {
        if (isAuthenticated) {
            usernameInputRef.current?.focus();
        } 
        // No email field to focus anymore
    }, [isAuthenticated]);

    // Simplified validation: only need username if authenticated and ready to join
    const validateForm = (): boolean => {
        if (isAuthenticated && !username.trim()) {
            setLocalError('Username is required to join the game');
            return false;
        }
        setLocalError(null); 
        return true;
    };

    // Handle button click: Either trigger OpenAuth login or join game
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!isAuthenticated) {
            // If not authenticated, start the OpenAuth login flow
            // Errors during loginRedirect are handled within AuthContext
            await loginRedirect(); 
        } else {
            // If authenticated, validate username and call handleLogin prop to join game
            if (validateForm()) {
                 handleLogin();
            }
        }
    };

    // Handle Enter key press
    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !authIsLoading) {
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
                
                {/* Display username input only when authenticated */}
                {isAuthenticated && (
                     <input
                        ref={usernameInputRef}
                        type="text"
                        placeholder="Enter Username"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        onKeyDown={handleKeyDown}
                        disabled={authIsLoading}
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
                )}

                {/* Combined Login/Join Button */}
                <form onSubmit={handleSubmit}> 
                    <button 
                        type="submit"
                        disabled={authIsLoading}
                        style={{ 
                            padding: '10px 20px',
                            border: `1px solid ${UI_BORDER_COLOR}`,
                            backgroundColor: authIsLoading ? UI_BUTTON_DISABLED_COLOR : UI_BUTTON_COLOR,
                            color: authIsLoading ? '#aaa' : 'white',
                            fontFamily: UI_FONT_FAMILY,
                            fontSize: '14px',
                            cursor: authIsLoading ? 'not-allowed' : 'pointer', 
                            boxShadow: UI_SHADOW,
                            width: '100%',
                            marginBottom: '15px',
                        }}
                    >
                        {authIsLoading ? 'Loading...' : (
                            isAuthenticated ? 'Join Game' : 'Sign In / Sign Up'
                        )}
                    </button>
                </form>
                
                {/* Error Messages from AuthContext or local validation */}
                {(localError || authError) && (
                    <p style={{ 
                        color: 'red', 
                        marginTop: '15px',
                        fontSize: '12px',
                        padding: '8px',
                        backgroundColor: 'rgba(255,0,0,0.1)',
                        borderRadius: '4px',
                    }}>
                        {localError || authError} 
                    </p>
                )}
                
                {/* Display logged in user info and logout button if authenticated */}
                {isAuthenticated && userProfile && (
                    <div style={{ 
                        marginTop: '20px', 
                        fontSize: '12px',
                        backgroundColor: 'rgba(0,255,0,0.1)',
                        padding: '10px',
                        borderRadius: '4px',
                    }}>
                        {/* Displaying userId for confirmation, adjust as needed */}
                        Logged in (User ID: {userProfile.userId})
                        <br />
                        <button
                            onClick={logout} // Call logout from useAuth
                            disabled={authIsLoading} // Disable during auth operations
                            style={{ 
                                marginTop: '10px',
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