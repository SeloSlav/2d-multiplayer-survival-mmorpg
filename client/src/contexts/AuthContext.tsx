import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { supabase, getCurrentUser, getSession, getAuthToken } from '../services/supabase';
import { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  supabaseToken: string | null;
  spacetimeToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  authError: string | null;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  supabaseToken: null,
  spacetimeToken: null,
  isLoading: true,
  isAuthenticated: false,
  authError: null,
  refreshUser: async () => {}
});

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [supabaseToken, setSupabaseToken] = useState<string | null>(null);
  const [spacetimeToken, setSpacetimeToken] = useState<string | null>(null);
  const [isSupabaseLoading, setIsSupabaseLoading] = useState<boolean>(true);
  const [isFetchingSpacetimeToken, setIsFetchingSpacetimeToken] = useState<boolean>(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const fetchSpacetimeToken = useCallback(async (supabaseAccessToken: string | null) => {
    if (!supabaseAccessToken) {
        setSpacetimeToken(null);
        setAuthError(null);
        return;
    }

    setIsFetchingSpacetimeToken(true);
    setAuthError(null);
    setSpacetimeToken(null);

    try {
        console.log("[AuthContext] Fetching SpacetimeDB token...");
        const response = await fetch('http://localhost:4000/verify', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token: supabaseAccessToken }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Auth server error (${response.status}): ${errorText || 'Failed to verify token'}`);
        }

        const data = await response.json();
        if (data.spacetime_token) {
            setSpacetimeToken(data.spacetime_token);
            console.log("[AuthContext] Fetched SpacetimeDB token successfully.");
        } else {
             throw new Error("Spacetime token missing in auth server response");
        }
    } catch (error: any) {
        console.error("[AuthContext] Error fetching SpacetimeDB token:", error);
        setAuthError(error.message || "Failed to get SpacetimeDB token");
        setSpacetimeToken(null);
    } finally {
        setIsFetchingSpacetimeToken(false);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    let currentSupabaseToken: string | null = null;
    try {
      setIsSupabaseLoading(true);
      setAuthError(null);
      const currentUser = await getCurrentUser();
      const currentSession = await getSession();
      currentSupabaseToken = currentSession?.access_token || null;

      setUser(currentUser || null);
      setSession(currentSession || null);
      setSupabaseToken(currentSupabaseToken);

      await fetchSpacetimeToken(currentSupabaseToken);

    } catch (error) {
      console.error('Error refreshing user:', error);
      setAuthError("Failed to refresh Supabase session");
      setUser(null);
      setSession(null);
      setSupabaseToken(null);
      setSpacetimeToken(null);
    } finally {
      setIsSupabaseLoading(false);
    }
  }, [fetchSpacetimeToken]);

  useEffect(() => {
    let mounted = true;

    async function initialLoad() {
      if (!mounted) return;
      await refreshUser();
    }

    initialLoad();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (!mounted) return;

        console.log("[AuthContext] Auth event:", event);
        const newSupabaseToken = session?.access_token || null;
        setUser(session?.user || null);
        setSession(session);
        setSupabaseToken(newSupabaseToken);
        setAuthError(null);

        if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED' || event === 'INITIAL_SESSION') {
           await fetchSpacetimeToken(newSupabaseToken);
        } else if (event === 'SIGNED_OUT') {
           setSpacetimeToken(null);
           setAuthError(null);
        }
        setIsSupabaseLoading(false);
      }
    );

    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, [refreshUser, fetchSpacetimeToken]);

  const combinedIsLoading = isSupabaseLoading || isFetchingSpacetimeToken;

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        supabaseToken,
        spacetimeToken,
        isLoading: combinedIsLoading,
        isAuthenticated: !!user && !!spacetimeToken,
        authError,
        refreshUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext); 