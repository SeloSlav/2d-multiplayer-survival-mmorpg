import { useState, useCallback } from 'react';

// Define the shape of the interaction target
export type InteractionTarget = { type: string; id: number | bigint } | null;

// Define the return type of the hook
interface InteractionManager {
    interactingWith: InteractionTarget;
    handleSetInteractingWith: (target: InteractionTarget) => void;
    // clearInteractionTarget: () => void; // Combine into handleSetInteractingWith(null)
}

export const useInteractionManager = (): InteractionManager => {
    const [interactingWith, setInteractingWith] = useState<InteractionTarget>(null);

    // Combine setting and clearing into one handler
    const handleSetInteractingWith = useCallback((target: InteractionTarget) => {
        console.log("[useInteractionManager] Setting interaction target:", target);
        setInteractingWith(target);
    }, []);

    // Optional: Clear function if needed separately, but handleSetInteractingWith(null) works
    // const clearInteractionTarget = useCallback(() => {
    //     console.log("[useInteractionManager] Clearing interaction target.");
    //     setInteractingWith(null);
    // }, []);

    return {
        interactingWith,
        handleSetInteractingWith,
        // clearInteractionTarget,
    };
}; 