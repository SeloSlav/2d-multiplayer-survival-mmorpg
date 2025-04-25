/**
 * LoginScreen.tsx
 * 
 * Displays the initial welcome/login screen.
 * Handles:
 *  - Displaying game title and logo.
 *  - Input fields for authentication (email, password, username).
 *  - Authentication with Supabase (email/password or OAuth).
 *  - Displaying loading states and errors.
 *  - Toggle between sign in and registration modes.
 */

import React, { useRef, useEffect, useState } from 'react';
import githubLogo from '../../public/github.png'; // Adjust path as needed
import { useAuth } from '../contexts/AuthContext';
import { signInWithEmail, signUpWithEmail, signInWithGoogle, signOut } from '../services/supabase';

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
    handleLogin: () => void;
    isLoading: boolean;
    error: string | null;
}

const LoginScreen: React.FC<LoginScreenProps> = ({
    username,
    setUsername,
    handleLogin,
    isLoading,
    error,
}) => {
    const { user, isAuthenticated } = useAuth();
    const [isSignUp, setIsSignUp] = useState<boolean>(false);
    const [email, setEmail] = useState<string>('');
    const [password, setPassword] = useState<string>('');
    const [confirmPassword, setConfirmPassword] = useState<string>('');
    const [authError, setAuthError] = useState<string | null>(null);
    const [authLoading, setAuthLoading] = useState<boolean>(false);

    const emailInputRef = useRef<HTMLInputElement>(null);
    const usernameInputRef = useRef<HTMLInputElement>(null);

    // Autofocus on initial render
    useEffect(() => {
        if (isAuthenticated) {
            // If user is already authenticated, focus username field
            usernameInputRef.current?.focus();
        } else {
            // Otherwise focus email field
            emailInputRef.current?.focus();
        }
    }, [isAuthenticated, isSignUp]);

    const validateForm = (): boolean => {
        if (isAuthenticated) {
            // If authenticated, only username matters for joining the game
            if (!username.trim()) {
                setAuthError('Username is required to join'); // More specific error
                return false;
            }
        } else {
            // If NOT authenticated, validate email/password/signup fields
            if (!email.trim()) {
                setAuthError('Email is required');
                return false;
            }
            if (!password.trim()) {
                setAuthError('Password is required');
                return false;
            }
            if (isSignUp) {
                if (password !== confirmPassword) {
                    setAuthError('Passwords do not match');
                    return false;
                }
                if (!username.trim()) {
                    setAuthError('Username is required for sign up'); // More specific error
                    return false;
                }
            }
        }
        // If all checks pass for the current state
        setAuthError(null); // Clear error if validation passes
        return true;
    };

    const handleAuthSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        
        if (!validateForm()) return;
        
        setAuthLoading(true);
        setAuthError(null);
        
        try {
            if (isAuthenticated) {
                // If already authenticated, just proceed with game login
                handleLogin();
            } else if (isSignUp) {
                // Register new user
                const { error } = await signUpWithEmail(email, password, username);
                if (error) throw error;
                // After signup, handleLogin will be called when auth state changes
            } else {
                // Sign in existing user
                const { error } = await signInWithEmail(email, password);
                if (error) throw error;
                // After signin, handleLogin will be called when auth state changes
            }
        } catch (err: any) {
            setAuthError(err.message || 'Authentication failed');
        } finally {
            setAuthLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setAuthLoading(true);
        setAuthError(null);
        
        try {
            await signInWithGoogle();
            // Auth state will be handled by the auth listener
        } catch (err: any) {
            setAuthError(err.message || 'Google sign-in failed');
            setAuthLoading(false);
        }
    };

    const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key === 'Enter' && !isLoading && !authLoading) {
            if (isAuthenticated) {
                // If already authenticated, just enter game
                if (username.trim()) {
                    handleLogin();
                }
            } else {
                // Otherwise submit the auth form
                handleAuthSubmit(event as unknown as React.FormEvent);
            }
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
                
                {/* AUTH FORM */}
                <form onSubmit={handleAuthSubmit} style={{ marginBottom: '20px' }}>
                    {!isAuthenticated ? (
                        /* Show auth fields if not authenticated */
                        <>
                            <input
                                ref={emailInputRef}
                                type="email"
                                placeholder="Email"
                                value={email}
                                onChange={(e) => setEmail(e.target.value)}
                                onKeyDown={handleKeyDown}
                                disabled={authLoading || isLoading}
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
                            
                            <input
                                type="password"
                                placeholder="Password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={handleKeyDown}
                                disabled={authLoading || isLoading}
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
                            
                            {isSignUp && (
                                <>
                                    <input
                                        type="password"
                                        placeholder="Confirm Password"
                                        value={confirmPassword}
                                        onChange={(e) => setConfirmPassword(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        disabled={authLoading || isLoading}
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
                                    
                                    <input
                                        ref={usernameInputRef}
                                        type="text"
                                        placeholder="Choose Username"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        onKeyDown={handleKeyDown}
                                        disabled={authLoading || isLoading}
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
                                </>
                            )}
                        </>
                    ) : (
                        /* If authenticated, no input needed, just the button below */
                        null // Render nothing here, the Join Game button handles the action
                    )}
                    
                    {/* Main Action Button - Moved outside the conditional */}
                    <button 
                        type="submit"
                        disabled={authLoading || isLoading}
                        style={{ 
                            padding: '10px 20px',
                            border: `1px solid ${UI_BORDER_COLOR}`,
                            backgroundColor: (authLoading || isLoading) ? UI_BUTTON_DISABLED_COLOR : UI_BUTTON_COLOR,
                            color: (authLoading || isLoading) ? '#aaa' : 'white',
                            fontFamily: UI_FONT_FAMILY,
                            fontSize: '14px',
                            cursor: (authLoading || isLoading) 
                                ? 'not-allowed' 
                                : 'pointer', 
                            boxShadow: UI_SHADOW,
                            width: '100%',
                            marginBottom: '15px',
                        }}
                    >
                        {authLoading ? 'Authenticating...' : (
                            isAuthenticated 
                                ? (isLoading ? 'Connecting...' : 'Join Game')
                                : (isSignUp ? 'Sign Up' : 'Sign In')
                        )}
                    </button>
                </form>
                
                {!isAuthenticated && (
                    <>
                        {/* Google Sign In Button */}
                        <button
                            onClick={handleGoogleSignIn}
                            disabled={authLoading || isLoading}
                            style={{ 
                                padding: '10px 20px',
                                border: `1px solid ${UI_BORDER_COLOR}`,
                                backgroundColor: (authLoading || isLoading) ? UI_BUTTON_DISABLED_COLOR : '#4285F4',
                                color: 'white',
                                fontFamily: UI_FONT_FAMILY,
                                fontSize: '14px',
                                cursor: (authLoading || isLoading) ? 'not-allowed' : 'pointer',
                                boxShadow: UI_SHADOW,
                                width: '100%',
                                marginBottom: '20px',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                            }}
                        >
                            <span style={{ marginRight: '10px' }}>G</span>
                            {isSignUp ? 'Sign Up with Google' : 'Sign In with Google'}
                        </button>
                        
                        {/* Toggle between sign in and sign up */}
                        <button
                            onClick={() => {
                                setIsSignUp(!isSignUp);
                                setAuthError(null);
                            }}
                            type="button"
                            style={{ 
                                background: 'none',
                                border: 'none',
                                color: '#a0a0c0',
                                cursor: 'pointer',
                                fontFamily: UI_FONT_FAMILY,
                                fontSize: '12px',
                                textDecoration: 'underline',
                                marginBottom: '15px',
                            }}
                        >
                            {isSignUp 
                                ? 'Already have an account? Sign In' 
                                : 'Need an account? Sign Up'}
                        </button>
                    </>
                )}
                
                {/* Error Messages */}
                {(authError || error) && (
                    <p style={{ 
                        color: 'red', 
                        marginTop: '15px',
                        fontSize: '12px',
                        padding: '8px',
                        backgroundColor: 'rgba(255,0,0,0.1)',
                        borderRadius: '4px',
                    }}>
                        {authError || error}
                    </p>
                )}
                
                {/* Display logged in user info if authenticated */}
                {isAuthenticated && user && (
                    <div style={{ 
                        marginTop: '20px', 
                        fontSize: '12px',
                        backgroundColor: 'rgba(0,255,0,0.1)',
                        padding: '10px',
                        borderRadius: '4px',
                    }}>
                        Logged in as: {user.email}
                        <br />
                        <button
                            onClick={async () => {
                                try {
                                    await signOut();
                                    setUsername('');
                                    setEmail('');
                                    setPassword('');
                                    setConfirmPassword('');
                                } catch (err) {
                                    console.error('Error signing out:', err);
                                    setAuthError('Failed to sign out');
                                }
                            }}
                            style={{ 
                                marginTop: '10px',
                                padding: '5px 10px',
                                fontSize: '10px',
                                background: '#444',
                                color: 'white',
                                border: 'none',
                                cursor: 'pointer',
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