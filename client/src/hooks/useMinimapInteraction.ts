import { useState, useEffect, useCallback, useRef, RefObject, useMemo } from 'react';
import { Player as SpacetimeDBPlayer, PlayerPin } from '../generated';
import { gameConfig } from '../config/gameConfig';
import { MINIMAP_DIMENSIONS, isPointInMinimap } from '../components/Minimap'; // Import dimensions

// Hook Constants
const MINIMAP_MAX_ZOOM = 10;
const MINIMAP_MIN_ZOOM = 1; // Represents showing the whole world
const MINIMAP_ZOOM_SENSITIVITY = 0.001;

interface UseMinimapInteractionProps {
    canvasRef: RefObject<HTMLCanvasElement | null>; // Allow null for canvasRef
    isMinimapOpen: boolean;
    connection: any | null;
    localPlayer?: SpacetimeDBPlayer;
    playerPins: Map<string, PlayerPin>; // Pass the whole map
    localPlayerId?: string;
    canvasSize: { width: number; height: number };
    setIsMinimapOpen: React.Dispatch<React.SetStateAction<boolean>>;
}

interface UseMinimapInteractionResult {
    minimapZoom: number;
    isMouseOverMinimap: boolean;
    localPlayerPin: PlayerPin | null;
    viewCenterOffset: { x: number; y: number };
    isMouseOverXButton: boolean;
}

export function useMinimapInteraction({
    canvasRef,
    isMinimapOpen,
    connection,
    localPlayer,
    playerPins,
    localPlayerId,
    canvasSize,
    setIsMinimapOpen,
}: UseMinimapInteractionProps): UseMinimapInteractionResult {

    const [minimapZoom, setMinimapZoom] = useState(MINIMAP_MIN_ZOOM);
    const [isMouseOverMinimap, setIsMouseOverMinimap] = useState(false);
    const [isMouseOverXButton, setIsMouseOverXButton] = useState(false);
    const [isPanning, setIsPanning] = useState(false);
    const [panStartCoords, setPanStartCoords] = useState<{ screenX: number, screenY: number } | null>(null);
    // Stores the offset of the view center from the default (player or world center) in WORLD coordinates
    const [viewCenterOffset, setViewCenterOffset] = useState<{ x: number, y: number }>({ x: 0, y: 0 });

    // Define world dimensions here
    const worldPixelWidth = gameConfig.worldWidth * gameConfig.tileSize;
    const worldPixelHeight = gameConfig.worldHeight * gameConfig.tileSize;

    // --- Base Scale Calculation ---
    const baseScale = useMemo(() => {
        const minimapWidth = canvasSize.width;
        const minimapHeight = canvasSize.height;
        const baseScaleX = minimapWidth / worldPixelWidth;
        const baseScaleY = minimapHeight / worldPixelHeight;
        return Math.min(baseScaleX, baseScaleY);
    }, [worldPixelWidth, worldPixelHeight, canvasSize.width, canvasSize.height]);

    // Derive local player's pin
    const localPlayerPin = useMemo(() => {
        if (!localPlayerId) return null;
        return playerPins.get(localPlayerId) || null;
    }, [playerPins, localPlayerId]);

    // Check if mouse is over minimap
    const checkMouseOverMinimap = useCallback((event: MouseEvent | WheelEvent) => {
        if (!canvasRef.current || !isMinimapOpen) return false;
        const rect = canvasRef.current.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;

        // For dedicated minimap canvas, the entire canvas is the minimap area
        return mouseX >= 0 && mouseX <= canvasSize.width &&
            mouseY >= 0 && mouseY <= canvasSize.height;
    }, [canvasRef, canvasSize.width, canvasSize.height, isMinimapOpen]);

    // Handle mouse move for hover effect & panning
    const handleMouseMove = useCallback((event: MouseEvent) => {
        const isOver = checkMouseOverMinimap(event);
        setIsMouseOverMinimap(isOver);
        
        // Check if mouse is over X button - for dedicated minimap canvas, X button is positioned differently
        if (!canvasRef.current || !isMinimapOpen) {
            setIsMouseOverXButton(false);
        } else {
            const rect = canvasRef.current.getBoundingClientRect();
            const mouseX = event.clientX - rect.left;
            const mouseY = event.clientY - rect.top;
            // X button is in top-right of the minimap canvas (will be handled by InterfaceContainer)
            setIsMouseOverXButton(false); // Disable for now - container handles close button
        }

        if (isPanning && panStartCoords && isOver) {
            const currentScale = baseScale * minimapZoom;
            if (currentScale <= 0) return; // Avoid division by zero

            const deltaXScreen = event.screenX - panStartCoords.screenX;
            const deltaYScreen = event.screenY - panStartCoords.screenY;

            // Convert screen delta to world delta
            const deltaXWorld = deltaXScreen / currentScale;
            const deltaYWorld = deltaYScreen / currentScale;

            // Calculate potential new offset
            const potentialNewOffsetX = viewCenterOffset.x - deltaXWorld;
            const potentialNewOffsetY = viewCenterOffset.y - deltaYWorld;

            // --- Panning Limits --- 
            let targetDefaultCenterXWorld = worldPixelWidth / 2;
            let targetDefaultCenterYWorld = worldPixelHeight / 2;
            if (localPlayer && minimapZoom > MINIMAP_MIN_ZOOM) { 
                targetDefaultCenterXWorld = localPlayer.positionX;
                targetDefaultCenterYWorld = localPlayer.positionY;
            }

            const potentialViewCenterX = targetDefaultCenterXWorld + potentialNewOffsetX;
            const potentialViewCenterY = targetDefaultCenterYWorld + potentialNewOffsetY;

            const viewWidthWorld = canvasSize.width / currentScale;
            const viewHeightWorld = canvasSize.height / currentScale;
            
            // Calculate potential view boundaries
            const potentialViewMinX = potentialViewCenterX - viewWidthWorld / 2;
            const potentialViewMaxX = potentialViewCenterX + viewWidthWorld / 2;
            const potentialViewMinY = potentialViewCenterY - viewHeightWorld / 2;
            const potentialViewMaxY = potentialViewCenterY + viewHeightWorld / 2;

            // Clamp the offset if the view goes too far out of world bounds
            let clampedNewOffsetX = potentialNewOffsetX;
            let clampedNewOffsetY = potentialNewOffsetY;

            // How much overlap to enforce (e.g., 50 world pixels)
            const minOverlap = 50;

            if (potentialViewMaxX < minOverlap) { // View is too far left
                const requiredCenterShiftX = minOverlap - potentialViewMaxX;
                clampedNewOffsetX += requiredCenterShiftX;
            } else if (potentialViewMinX > worldPixelWidth - minOverlap) { // View is too far right
                const requiredCenterShiftX = (worldPixelWidth - minOverlap) - potentialViewMinX;
                clampedNewOffsetX += requiredCenterShiftX;
            }

            if (potentialViewMaxY < minOverlap) { // View is too far up
                const requiredCenterShiftY = minOverlap - potentialViewMaxY;
                clampedNewOffsetY += requiredCenterShiftY;
            } else if (potentialViewMinY > worldPixelHeight - minOverlap) { // View is too far down
                const requiredCenterShiftY = (worldPixelHeight - minOverlap) - potentialViewMinY;
                clampedNewOffsetY += requiredCenterShiftY;
            }

            setViewCenterOffset(prevOffset => ({ 
                x: clampedNewOffsetX,
                y: clampedNewOffsetY,
            }));

            // Update pan start for next move event
            setPanStartCoords({ screenX: event.screenX, screenY: event.screenY });
        }
    }, [checkMouseOverMinimap, isPanning, panStartCoords, baseScale, minimapZoom, viewCenterOffset.x, viewCenterOffset.y, localPlayer, worldPixelWidth, worldPixelHeight]);

    // Handle scroll wheel zoom (zoom at cursor)
    const handleWheel = useCallback((event: WheelEvent) => {
        if (!isMinimapOpen || !checkMouseOverMinimap(event) || !canvasRef.current) return; 

        event.preventDefault(); // Prevent page scroll

        // --- Calculate zoom delta and new zoom level --- 
        const delta = event.deltaY * -MINIMAP_ZOOM_SENSITIVITY;
        const oldZoom = minimapZoom; // Store the zoom level before the update
        const newZoomAttempt = oldZoom + delta;
        const newZoom = Math.max(MINIMAP_MIN_ZOOM, Math.min(MINIMAP_MAX_ZOOM, newZoomAttempt));
        
        if (Math.abs(newZoom - oldZoom) < 0.0001) return; // No significant zoom change

        // --- Calculate world point under cursor BEFORE zoom --- 
        const rect = canvasRef.current.getBoundingClientRect();
        const mouseXCanvas = event.clientX - rect.left;
        const mouseYCanvas = event.clientY - rect.top;

        // For dedicated minimap canvas, use the full canvas dimensions
        const minimapWidth = canvasSize.width;
        const minimapHeight = canvasSize.height;
        const minimapX = 0; // Top-left of canvas
        const minimapY = 0;

        // Determine the CURRENT view center (player + offset, or world center)
        let currentViewCenterXWorld: number;
        let currentViewCenterYWorld: number;

        // **Correction:** Base the CURRENT center calculation strictly on the OLD zoom level
        if (oldZoom <= MINIMAP_MIN_ZOOM || !localPlayer) {
            // World centered (offset is ignored when world centered)
            currentViewCenterXWorld = worldPixelWidth / 2;
            currentViewCenterYWorld = worldPixelHeight / 2;
        } else {
            // Player centered + current offset
            currentViewCenterXWorld = localPlayer.positionX + viewCenterOffset.x;
            currentViewCenterYWorld = localPlayer.positionY + viewCenterOffset.y;
        }

        const currentScale = baseScale * oldZoom;
        const currentViewWidthWorld = minimapWidth / currentScale;
        const currentViewHeightWorld = minimapHeight / currentScale;
        const currentViewMinXWorld = currentViewCenterXWorld - currentViewWidthWorld / 2;
        const currentViewMinYWorld = currentViewCenterYWorld - currentViewHeightWorld / 2;

        // Mouse position relative to minimap top-left
        const mouseXMinimap = mouseXCanvas - minimapX;
        const mouseYMinimap = mouseYCanvas - minimapY;

        // World coordinates under the mouse before zoom - Calculated correctly based on current view
        const worldXUnderMouse = currentViewMinXWorld + (mouseXMinimap / currentScale);
        const worldYUnderMouse = currentViewMinYWorld + (mouseYMinimap / currentScale);

        // --- Apply Zoom (State Update) --- 
        setMinimapZoom(newZoom); // Update the zoom state for the next render cycle

        // --- Calculate Required Offset Adjustment AFTER zoom --- 
        const newScale = baseScale * newZoom;
        
        // Determine the TARGET default center (where the view WILL be centered by default after zoom)
        let targetDefaultCenterXWorld: number;
        let targetDefaultCenterYWorld: number;
        
        if (newZoom <= MINIMAP_MIN_ZOOM || !localPlayer) { // If new zoom is <= 1, target is world center
            targetDefaultCenterXWorld = worldPixelWidth / 2;
            targetDefaultCenterYWorld = worldPixelHeight / 2;
        } else { // Otherwise, target is player center
            targetDefaultCenterXWorld = localPlayer.positionX;
            targetDefaultCenterYWorld = localPlayer.positionY;
        }

        // Calculate the required view center (targetDefaultCenter + newOffset)
        // such that worldX/YUnderMouse remains at mouseX/YMinimap
        const requiredCenterXWorld = worldXUnderMouse - (mouseXMinimap / newScale) + (minimapWidth / newScale / 2);
        const requiredCenterYWorld = worldYUnderMouse - (mouseYMinimap / newScale) + (minimapHeight / newScale / 2);
        
        // Calculate the new offset needed relative to the target default center
        const newOffsetX = requiredCenterXWorld - targetDefaultCenterXWorld;
        const newOffsetY = requiredCenterYWorld - targetDefaultCenterYWorld;

        // Set the new offset (State Update)
        setViewCenterOffset({ x: newOffsetX, y: newOffsetY });

    }, [ 
        isMinimapOpen, checkMouseOverMinimap, minimapZoom, baseScale, 
        canvasRef, canvasSize, localPlayer, viewCenterOffset.x, viewCenterOffset.y, 
        worldPixelWidth, worldPixelHeight 
    ]);

    // Handle right-click for pinning
    const handleContextMenu = useCallback((event: MouseEvent) => {
        if (!isMinimapOpen || !checkMouseOverMinimap(event) || !canvasRef.current) return; 

        event.preventDefault(); // Prevent default context menu

        if (!connection?.reducers) {
            console.error("Cannot set pin: Connection not available.");
            return;
        }

        const rect = canvasRef.current.getBoundingClientRect();
        const clickXCanvas = event.clientX - rect.left;
        const clickYCanvas = event.clientY - rect.top;

        // For dedicated minimap canvas, use the full canvas dimensions
        const minimapWidth = canvasSize.width;
        const minimapHeight = canvasSize.height;
        const minimapX = 0; // Top-left of canvas
        const minimapY = 0;

        let worldX: number | undefined; // Initialize as undefined
        let worldY: number | undefined;
        const clickXMinimap = clickXCanvas - minimapX; // Click relative to minimap UI top-left
        const clickYMinimap = clickYCanvas - minimapY;

        const currentScale = baseScale * minimapZoom;

        if (minimapZoom <= MINIMAP_MIN_ZOOM) {
            // Fully zoomed out: Calculate relative to the base world view centered in the minimap box
            const baseEffectiveDrawWidth = worldPixelWidth * baseScale;
            const baseEffectiveDrawHeight = worldPixelHeight * baseScale;
            
            // Calculate the padding inside the minimap box before the world map starts
            const paddingX = (minimapWidth - baseEffectiveDrawWidth) / 2;
            const paddingY = (minimapHeight - baseEffectiveDrawHeight) / 2;

            // Click position relative to the actual rendered world map's top-left corner
            const clickXRelative = clickXMinimap - paddingX;
            const clickYRelative = clickYMinimap - paddingY;

            // Ensure click is within the rendered world bounds before converting
            if (clickXRelative >= 0 && clickXRelative <= baseEffectiveDrawWidth &&
                clickYRelative >= 0 && clickYRelative <= baseEffectiveDrawHeight) 
            {
                // Convert to world coordinates using baseScale
                worldX = clickXRelative / baseScale;
                worldY = clickYRelative / baseScale;
            } else {
                // Click was in the padding area, ignore
                // console.log("Pin click outside world bounds (in padding).");
                return; 
            }
        
        } else { // Zoomed in: Calculate relative to the current view (centered on player + offset)
             let currentDefaultCenterXWorld = worldPixelWidth / 2; // Fallback
             let currentDefaultCenterYWorld = worldPixelHeight / 2;
             if (localPlayer) { // If player exists, default center is player
                 currentDefaultCenterXWorld = localPlayer.positionX;
                 currentDefaultCenterYWorld = localPlayer.positionY;
             }
            const currentViewCenterXWorld = currentDefaultCenterXWorld + viewCenterOffset.x;
            const currentViewCenterYWorld = currentDefaultCenterYWorld + viewCenterOffset.y;

            const viewWidthWorld = minimapWidth / currentScale;
            const viewHeightWorld = minimapHeight / currentScale;
            const viewMinXWorld = currentViewCenterXWorld - viewWidthWorld / 2;
            const viewMinYWorld = currentViewCenterYWorld - viewHeightWorld / 2;

            worldX = viewMinXWorld + (clickXMinimap / currentScale);
            worldY = viewMinYWorld + (clickYMinimap / currentScale);
        }

        // Clamp and call reducer only if worldX/Y were successfully calculated
        if (worldX !== undefined && worldY !== undefined) {
            const clampedWorldX = Math.max(0, Math.min(worldPixelWidth, Math.round(worldX)));
            const clampedWorldY = Math.max(0, Math.min(worldPixelHeight, Math.round(worldY)));

            // console.log(`Setting pin at world coordinates: (${clampedWorldX}, ${clampedWorldY})`);
            try {
                connection.reducers.setPlayerPin(clampedWorldX, clampedWorldY);
            } catch (err) {
                console.error("Error calling setPlayerPin reducer:", err);
            }
        }

    }, [ 
        isMinimapOpen, checkMouseOverMinimap, connection, canvasRef, canvasSize, 
        minimapZoom, localPlayer, baseScale, viewCenterOffset.x, viewCenterOffset.y, 
        worldPixelWidth, worldPixelHeight 
    ]);

    // Handle Mouse Down for Panning and UI interactions
    const handleMouseDown = useCallback((event: MouseEvent) => {
        // Check for UI interactions first and prevent event propagation
        if (!canvasRef.current || !isMinimapOpen) return;
        
        const rect = canvasRef.current.getBoundingClientRect();
        const mouseX = event.clientX - rect.left;
        const mouseY = event.clientY - rect.top;
        
        console.log('[Minimap] Mouse down detected, button:', event.button, 'zoom:', minimapZoom, 'isOverMinimap:', checkMouseOverMinimap(event));
        
        // For dedicated canvas, clicking anywhere on canvas is within minimap
        // X button clicks are handled by InterfaceContainer, not here
        
        // If clicking on minimap but not on X button, handle normal minimap interactions
        if (checkMouseOverMinimap(event)) {
            // Prevent attack/action when clicking on minimap
            event.preventDefault();
            event.stopPropagation();
            
            // Middle mouse button reset
            if (event.button === 1) {
                console.log('[Minimap] Middle click - resetting zoom');
                setMinimapZoom(MINIMAP_MIN_ZOOM);
                setViewCenterOffset({ x: 0, y: 0 });
                setIsPanning(false); // Ensure panning stops
                setPanStartCoords(null);
                return; // Don't start panning if middle click
            }

            // Only pan with left click when zoomed and over the minimap
            if (event.button === 0 && minimapZoom > MINIMAP_MIN_ZOOM) {
                console.log('[Minimap] Starting panning');
                setIsPanning(true);
                setPanStartCoords({ screenX: event.screenX, screenY: event.screenY });
            }
        }
    }, [isMinimapOpen, minimapZoom, checkMouseOverMinimap, setMinimapZoom, setViewCenterOffset, canvasRef, canvasSize.width, canvasSize.height, setIsMinimapOpen]); // Added setters

    // Handle Mouse Up for Panning (Define BEFORE useEffect)
    const handleMouseUp = useCallback((event: MouseEvent) => {
        // Always clear panning state regardless of which button was released
        // This ensures we don't get stuck in panning mode
        console.log('[Minimap] Mouse up detected, isPanning:', isPanning, 'button:', event.button);
        if (isPanning) {
            console.log('[Minimap] Stopping panning');
            setIsPanning(false);
            setPanStartCoords(null);
        }
    }, [isPanning]);

    // Handle mouse leave to ensure we stop panning if mouse leaves the canvas
    const handleMouseLeave = useCallback(() => {
        console.log('[Minimap] Mouse leave detected, isPanning:', isPanning);
        if (isPanning) {
            console.log('[Minimap] Stopping panning due to mouse leave');
            setIsPanning(false);
            setPanStartCoords(null);
        }
    }, [isPanning]);

    // Handle visibility change to stop panning if tab becomes hidden
    const handleVisibilityChange = useCallback(() => {
        if (document.hidden && isPanning) {
            console.log('[Minimap] Stopping panning due to visibility change');
            setIsPanning(false);
            setPanStartCoords(null);
        }
    }, [isPanning]);

    // Add a global mouse up handler that works even if events are stopped
    const handleGlobalMouseUp = useCallback((event: MouseEvent) => {
        console.log('[Minimap] Global mouse up detected, isPanning:', isPanning);
        if (isPanning) {
            console.log('[Minimap] Force stopping panning via global handler');
            setIsPanning(false);
            setPanStartCoords(null);
        }
    }, [isPanning]);

    // Add/remove event listeners
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.addEventListener('mousemove', handleMouseMove);
        canvas.addEventListener('wheel', handleWheel, { passive: false });
        canvas.addEventListener('contextmenu', handleContextMenu);
        canvas.addEventListener('mousedown', handleMouseDown);
        canvas.addEventListener('mouseup', handleMouseUp); // Add canvas mouseup
        canvas.addEventListener('mouseleave', handleMouseLeave);
        
        // Add mouseup listener to window to catch panning ending outside canvas
        window.addEventListener('mouseup', handleMouseUp);
        // Add a more aggressive global mouseup handler with capture
        document.addEventListener('mouseup', handleGlobalMouseUp, true);
        // Add visibility change listener to stop panning when tab is hidden
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            canvas.removeEventListener('mousemove', handleMouseMove);
            canvas.removeEventListener('wheel', handleWheel);
            canvas.removeEventListener('contextmenu', handleContextMenu);
            canvas.removeEventListener('mousedown', handleMouseDown);
            canvas.removeEventListener('mouseup', handleMouseUp); // Remove canvas mouseup
            canvas.removeEventListener('mouseleave', handleMouseLeave);
            window.removeEventListener('mouseup', handleMouseUp);
            document.removeEventListener('mouseup', handleGlobalMouseUp, true);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [canvasRef, handleMouseMove, handleWheel, handleContextMenu, handleMouseDown, handleMouseUp, handleMouseLeave, handleVisibilityChange, handleGlobalMouseUp]); // Add global handler

    // Effect to manage cursor style
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        // Store previous cursor to restore it
        const originalCursor = canvas.style.cursor || 'crosshair'; 

        if (!isMinimapOpen) {
             canvas.style.cursor = originalCursor; // Reset if minimap closes
             return;
        }

        if (isPanning) {
            canvas.style.cursor = 'grabbing';
        } else if (isMouseOverMinimap && minimapZoom > MINIMAP_MIN_ZOOM) {
            canvas.style.cursor = 'grab';
        } else {
            canvas.style.cursor = originalCursor; // Reset to original/default
        }

        // Cleanup function to reset cursor
        return () => {
            if (canvas) {
                canvas.style.cursor = originalCursor; // Reset on cleanup
            }
        };
    }, [canvasRef, isMinimapOpen, isMouseOverMinimap, isPanning, minimapZoom]);

    // Reset pan offset when minimap is closed or zoom returns to 1
    useEffect(() => {
        if (!isMinimapOpen || minimapZoom <= MINIMAP_MIN_ZOOM) {
            setViewCenterOffset({ x: 0, y: 0 });
            setIsPanning(false); // Ensure panning stops if zoom resets
            setPanStartCoords(null);
        }
    }, [isMinimapOpen, minimapZoom]);

    // Force cleanup of panning state on component unmount or when canvas changes
    useEffect(() => {
        return () => {
            setIsPanning(false);
            setPanStartCoords(null);
        };
    }, [canvasRef]);

    return {
        minimapZoom,
        isMouseOverMinimap,
        localPlayerPin,
        viewCenterOffset, 
        isMouseOverXButton,
    };
} 