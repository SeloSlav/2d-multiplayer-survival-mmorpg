import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { supabase, getCurrentUser, getSession, getAuthToken } from '../services/supabase';
import { User, Session } from '@supabase/supabase-js';

interface AuthContextType {
  user: User | null;
  session: Session | null;
  authToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  authToken: null, 
  isLoading: true,
  isAuthenticated: false,
  refreshUser: async () => {}
});

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Function to refresh user data
  const refreshUser = async () => {
    try {
      setIsLoading(true);
      const currentUser = await getCurrentUser();
      const currentSession = await getSession();
      const token = currentSession?.access_token || null;
      
      setUser(currentUser || null);
      setSession(currentSession || null);
      setAuthToken(token);
    } catch (error) {
      console.error('Error refreshing user:', error);
      setUser(null);
      setSession(null);
      setAuthToken(null);
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load and set up auth state listener
  useEffect(() => {
    let mounted = true;

    async function initialSession() {
      if (!mounted) return;
      setIsLoading(true);
      
      try {
        await refreshUser();
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    initialSession();

    // Set up auth state change listener
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (mounted) {
          setUser(session?.user || null);
          setSession(session);
          setAuthToken(session?.access_token || null);
        }
      }
    );

    return () => {
      mounted = false;
      authListener?.subscription.unsubscribe();
    };
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        authToken,
        isLoading,
        isAuthenticated: !!user,
        refreshUser
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// Custom hook for using the auth context
export const useAuth = () => useContext(AuthContext); 