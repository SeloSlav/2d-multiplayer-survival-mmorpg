import React, { createContext, useContext, useState, ReactNode } from 'react';

interface DebugContextType {
    showAutotileDebug: boolean;
    toggleAutotileDebug: () => void;
}

const DebugContext = createContext<DebugContextType | undefined>(undefined);

export const useDebug = () => {
    const context = useContext(DebugContext);
    if (context === undefined) {
        throw new Error('useDebug must be used within a DebugProvider');
    }
    return context;
};

interface DebugProviderProps {
    children: ReactNode;
}

export const DebugProvider: React.FC<DebugProviderProps> = ({ children }) => {
    const [showAutotileDebug, setShowAutotileDebug] = useState(false);

    const toggleAutotileDebug = () => {
        setShowAutotileDebug(prev => !prev);
        console.log('[DebugContext] Autotile debug overlay:', !showAutotileDebug ? 'enabled' : 'disabled');
    };

    const value = {
        showAutotileDebug,
        toggleAutotileDebug,
    };

    return (
        <DebugContext.Provider value={value}>
            {children}
        </DebugContext.Provider>
    );
}; 