import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
// Import OpenAuth client helpers
import { createClient /*, OAuthClient */ } from '@openauthjs/openauth/client'; 
import { parseJwt } from '../utils/auth/jwt'; // Corrected import path
// Removed Node.js specific imports
// import { Buffer } from 'buffer'; 
// import crypto from 'crypto'; 

// --- Configuration ---
const AUTH_SERVER_URL = 'http://localhost:4001'; // URL of your OpenAuth server
const OIDC_CLIENT_ID = 'vibe-survival-game-client'; // An identifier for this React app
const REDIRECT_URI = window.location.origin + '/callback'; // Where OpenAuth redirects back after login
const LOCAL_STORAGE_KEYS = {
    ID_TOKEN: 'oidc_id_token',
    ACCESS_TOKEN: 'oidc_access_token',
    REFRESH_TOKEN: 'oidc_refresh_token',
    PKCE_VERIFIER: 'pkce_verifier',
};

interface UserProfile {
    userId: string; // Extracted from id_token subject
    // Add other relevant fields if available in the token (e.g., email, username)
}

interface AuthContextType {
  userProfile: UserProfile | null;      // Simplified user info from token
  spacetimeToken: string | null;      // This will be the id_token
  isLoading: boolean;                 // Is an auth operation in progress?
  isAuthenticated: boolean;           // Based on presence of spacetimeToken
  authError: string | null;           // Store auth-related errors
  loginRedirect: () => Promise<void>; // Function to start login flow
  logout: () => Promise<void>;        // Function to logout
  handleRedirectCallback: () => Promise<void>; // Function to process callback
}

const AuthContext = createContext<AuthContextType>({
  userProfile: null,
  spacetimeToken: null,
  isLoading: true, // Start loading until initial check is done
  isAuthenticated: false,
  authError: null,
  loginRedirect: async () => { console.warn("AuthContext not initialized"); },
  logout: async () => { console.warn("AuthContext not initialized"); },
  handleRedirectCallback: async () => { console.warn("AuthContext not initialized"); },
});

interface AuthProviderProps {
  children: ReactNode;
}

// Helper function for Base64URL encoding in browser
function arrayBufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    // Standard Base64 encoding
    const base64 = window.btoa(binary);
    // Convert Base64 to Base64URL
    return base64
        .replace(/\+/g, '-') // Replace + with -
        .replace(/\//g, '_') // Replace / with _
        .replace(/=/g, '');   // Remove padding =
}

// Helper function for PKCE using Web Crypto API
async function generatePkceChallenge(verifier: string): Promise<{ code_verifier: string; code_challenge: string; code_challenge_method: string }> {
    const code_verifier = verifier;
    const encoder = new TextEncoder();
    const data = encoder.encode(verifier);
    // Use Web Crypto API for SHA-256
    const digest = await window.crypto.subtle.digest('SHA-256', data);
    // Encode the ArrayBuffer result to Base64URL
    const code_challenge = arrayBufferToBase64Url(digest);
    return {
        code_verifier,
        code_challenge,
        code_challenge_method: 'S256'
    };
}

function generateRandomString(length: number): string {
    const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    let result = '';
    const charactersLength = characters.length;
    for (let i = 0; i < length; i++) {
        result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [spacetimeToken, setSpacetimeToken] = useState<string | null>(() => {
      const storedToken = localStorage.getItem(LOCAL_STORAGE_KEYS.ID_TOKEN);
      console.log(`[AuthContext LOG] Initializing token state. Found in storage: ${!!storedToken}`); // <-- LOG initialization
      return storedToken;
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [authError, setAuthError] = useState<string | null>(null);

  // Initialize OpenAuth client
  const [oidcClient] = useState(() => createClient({
      issuer: AUTH_SERVER_URL,
      clientID: OIDC_CLIENT_ID,
  }));

  // --- Core Auth Functions ---

  const loginRedirect = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    try {
        console.log("[AuthContext] Initiating login redirect manually for password flow...");
        
        // 1. Generate PKCE Verifier and Challenge
        const verifier = generateRandomString(128); // Generate a random verifier
        const pkce = await generatePkceChallenge(verifier);
        localStorage.setItem(LOCAL_STORAGE_KEYS.PKCE_VERIFIER, pkce.code_verifier);

        // 2. Generate State
        const state = generateRandomString(32); // Generate random state
        // Optional: Store state locally if needed for validation on callback

        // 3. Construct Authorization URL
        const authUrl = new URL('/authorize', AUTH_SERVER_URL);
        authUrl.searchParams.set('client_id', OIDC_CLIENT_ID);
        authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
        authUrl.searchParams.set('response_type', 'code');
        authUrl.searchParams.set('state', state);
        authUrl.searchParams.set('code_challenge', pkce.code_challenge);
        authUrl.searchParams.set('code_challenge_method', pkce.code_challenge_method);
        authUrl.searchParams.set('acr_values', 'pwd'); // Add acr_values

        console.log("[AuthContext] Redirecting to manually constructed URL:", authUrl.toString());
        window.location.assign(authUrl.toString()); // Redirect user

    } catch (error: any) {
        console.error("[AuthContext] Error initiating manual login redirect:", error);
        setAuthError(error.message || "Failed to start login process");
        setIsLoading(false);
    }
  }, []); // Removed oidcClient dependency as we're not using its authorize method directly

  const handleRedirectCallback = useCallback(async () => {
    setIsLoading(true);
    setAuthError(null);
    console.log("[AuthContext LOG] START: Handling redirect callback...");

    const queryParams = new URLSearchParams(window.location.search);
    const code = queryParams.get("code");
    const state = queryParams.get("state");

    window.history.replaceState({}, document.title, window.location.pathname);

    if (!code) {
        console.warn("[AuthContext] No authorization code found in callback URL.");
        // Check for error parameters (e.g., error=access_denied)
        const error = queryParams.get("error");
        const errorDesc = queryParams.get("error_description");
        if (error) {
             setAuthError(`Authentication failed: ${error} ${errorDesc ? `(${errorDesc})` : ''}`);
        } else {
            // Might be initial load without callback, check existing token
            const existingToken = localStorage.getItem(LOCAL_STORAGE_KEYS.ID_TOKEN);
            if (existingToken) {
                 console.log("[AuthContext] No code in URL, but found existing token.");
                 setSpacetimeToken(existingToken);
                 // TODO: Parse existing token to set userProfile
                 const profile = parseToken(existingToken);
                 setUserProfile(profile);
            } else {
                console.log("[AuthContext] No code and no existing token.");
            }
        }
        setIsLoading(false);
        console.log("[AuthContext LOG] END: No code found in redirect callback.");
        return;
    }

    const verifier = localStorage.getItem(LOCAL_STORAGE_KEYS.PKCE_VERIFIER);
    // Now we strictly need the verifier again
    if (!verifier) {
        console.error("[AuthContext] PKCE verifier missing from storage.");
        setAuthError("Authentication context lost. Please try logging in again.");
        setIsLoading(false);
        console.log("[AuthContext LOG] END: PKCE verifier missing.");
        return;
    }
    localStorage.removeItem(LOCAL_STORAGE_KEYS.PKCE_VERIFIER); // Clean up verifier

    try {
        console.log("[AuthContext LOG] Exchanging code for tokens...");
        
        // Construct form data payload for the token endpoint
        const tokenRequestBody = new URLSearchParams();
        tokenRequestBody.append('grant_type', 'authorization_code');
        tokenRequestBody.append('code', code!); // Code is guaranteed to exist here
        tokenRequestBody.append('redirect_uri', REDIRECT_URI);
        tokenRequestBody.append('client_id', OIDC_CLIENT_ID);
        tokenRequestBody.append('code_verifier', verifier); // Verifier is guaranteed to exist here

        // Make the POST request to the token endpoint
        const tokenResponse = await fetch(`${AUTH_SERVER_URL}/token`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: tokenRequestBody.toString(),
        });

        const tokens = await tokenResponse.json();

        if (!tokenResponse.ok) {
            console.error("[AuthContext] Token exchange failed:", tokens);
            const errorDescription = tokens.error_description || tokens.error || `HTTP status ${tokenResponse.status}`;
            throw new Error(`Token exchange failed: ${errorDescription}`);
        }
        
        // Extract tokens directly from the JSON response
        const id_token = tokens.id_token as string | undefined;
        const access_token = tokens.access_token as string | undefined;
        const refresh_token = tokens.refresh_token as string | undefined;
        
        console.log("[AuthContext LOG] Tokens received (id_token present?):", !!id_token);

        if (!id_token) {
             throw new Error("id_token missing from token response");
        }

        // Store tokens
        localStorage.setItem(LOCAL_STORAGE_KEYS.ID_TOKEN, id_token);
        if (access_token) localStorage.setItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN, access_token);
        if (refresh_token) localStorage.setItem(LOCAL_STORAGE_KEYS.REFRESH_TOKEN, refresh_token);

        // Set state (This will trigger the useEffect below)
        console.log("[AuthContext LOG] Setting spacetimeToken state AFTER successful callback.");
        setSpacetimeToken(id_token);
        const profile = parseToken(id_token);
        setUserProfile(profile);
        setAuthError(null);

        // Redirect to the main application page
        console.log("[AuthContext LOG] END: Callback handled successfully, redirecting to '/'...");
        window.location.replace('/');

    } catch (error: any) {
        console.error("[AuthContext] Error handling redirect callback:", error);
        setAuthError(error.message || "Failed to process login callback");
        // Clear potentially partial tokens
        clearTokens();
        setSpacetimeToken(null);
        setUserProfile(null);
        console.log("[AuthContext LOG] END: Error during callback handling.");
    } finally {
        setIsLoading(false);
    }
  }, []);

  const logout = useCallback(async () => {
    console.log("[AuthContext LOG] Logging out...");
    setIsLoading(true);
    clearTokens();
    setSpacetimeToken(null);
    setUserProfile(null);
    setAuthError(null);

    // Optional: Redirect to OpenAuth end session endpoint if available/needed
    // This might require constructing a URL with id_token_hint and post_logout_redirect_uri
    // const endSessionUrl = `${AUTH_SERVER_URL}/protocol/openid-connect/logout?client_id=${OIDC_CLIENT_ID}&post_logout_redirect_uri=${encodeURIComponent(window.location.origin)}`;
    // window.location.assign(endSessionUrl); 
    
    // For simplicity now, just clear client-side state
    console.log("[AuthContext LOG] Cleared state and tokens for logout.");
    setIsLoading(false); 
    // Force reload or redirect to home to clear application state if needed
    window.location.assign(window.location.origin); 

  }, []);

  // --- Helper Functions ---
  const clearTokens = () => {
      localStorage.removeItem(LOCAL_STORAGE_KEYS.ID_TOKEN);
      localStorage.removeItem(LOCAL_STORAGE_KEYS.ACCESS_TOKEN);
      localStorage.removeItem(LOCAL_STORAGE_KEYS.REFRESH_TOKEN);
      localStorage.removeItem(LOCAL_STORAGE_KEYS.PKCE_VERIFIER); // Just in case
      setSpacetimeToken(null); 
      setUserProfile(null);
      console.log("[AuthContext LOG] Cleared tokens from storage AND state.");
  };

  const parseToken = (token: string): UserProfile | null => {
       try {
            const decoded = parseJwt(token);
            const userId = decoded.sub || decoded.userId; 
            if (!userId) {
                 console.error("Could not find userId (sub or userId) in token payload:", decoded);
                 return null;
            }
            return { userId: userId };
       } catch (error) {
            console.error("Error parsing token:", error);
            // Don't set authError here directly, let callers handle
            return null;
       }
  };

  // --- Effect for Initial Load / Handling Redirect ---
  useEffect(() => {
    // Only handle redirect OR set initial user profile
    if (window.location.pathname === new URL(REDIRECT_URI).pathname) {
      console.log("[AuthContext LOG] Initial Load: Detected callback URL, invoking handler..."); 
      handleRedirectCallback();
    } else {
      // --- MODIFIED: Token is already initialized. Just parse profile and finish loading. ---
      if (spacetimeToken) { 
          console.log("[AuthContext LOG] Initial Load: Token was pre-loaded from storage. Parsing profile.");
          const profile = parseToken(spacetimeToken);
          if (profile) {
              setUserProfile(profile);
              console.log("[AuthContext LOG] Initial Load: Profile parsed successfully.");
          } else {
              console.error("[AuthContext LOG] Initial Load: Failed to parse pre-loaded token. Clearing token.");
              clearTokens(); // Clear invalid stored token and state
          }
      } else {
         console.log("[AuthContext LOG] Initial Load: No token was pre-loaded from storage."); 
      }
      setIsLoading(false); // Finished initial non-callback load
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handleRedirectCallback]); // Keep handleRedirectCallback, but token check happens outside effect now

  // --- Effect to Log Token Changes ---
  useEffect(() => {
    // This log will now reflect changes from login, logout, or clearing invalid tokens
    console.log("[AuthContext LOG] spacetimeToken STATE CHANGED to:", spacetimeToken ? `token starting with ${spacetimeToken.substring(0, 10)}...` : null);
  }, [spacetimeToken]); 

  const isAuthenticated = !!spacetimeToken;

  return (
    <AuthContext.Provider
      value={{
        userProfile,
        spacetimeToken,
        isLoading,
        isAuthenticated,
        authError,
        loginRedirect,
        logout,
        handleRedirectCallback
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext); 