/**
 * useInteractionAutoClose Hook
 * 
 * Automatically clears the interaction target (closes container UI) when
 * the player moves too far from the entity they're interacting with.
 * Each container type has its own distance threshold and position calculation.
 * 
 * IMPORTANT: The distance logic here must stay in sync with the interaction target runtime.
 * If the interaction finder says "you're in range" (blue box shows), this hook
 * must NOT close the UI. Uses matching asymmetric logic + generous buffer.
 */

import { useEffect } from 'react';
import { Identity } from 'spacetimedb';
import { Player, Campfire, Furnace, Fumarole, WoodenStorageBox, Stash, PlayerCorpse, RainCollector } from '../generated/types';
import { InteractionTarget } from './useInteractionManager';
import { PLAYER_BOX_INTERACTION_DISTANCE_SQUARED, PLAYER_TALL_BOX_INTERACTION_DISTANCE_SQUARED, PLAYER_BEEHIVE_INTERACTION_DISTANCE_SQUARED, getBoxDimensions, BOX_TYPE_COMPOST, BOX_TYPE_TANNING_RACK, BOX_TYPE_COOKING_STATION, BOX_TYPE_REPAIR_BENCH, BOX_TYPE_PLAYER_BEEHIVE, BOX_TYPE_WILD_BEEHIVE, MONUMENT_COMPOST_HEIGHT, MONUMENT_COOKING_STATION_HEIGHT, MONUMENT_REPAIR_BENCH_HEIGHT } from '../utils/renderers/woodenStorageBoxRenderingUtils';
import { PLAYER_MONUMENT_BOX_INTERACTION_DISTANCE_SQUARED } from '../engine/runtime/interactionTargetRuntime';
import { PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED, CAMPFIRE_HEIGHT, CAMPFIRE_RENDER_Y_OFFSET } from '../utils/renderers/campfireRenderingUtils';
import {
    PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED,
    PLAYER_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED,
    PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED,
    FURNACE_TYPE_LARGE,
    MONUMENT_LARGE_FURNACE_HEIGHT,
    MONUMENT_LARGE_FURNACE_RENDER_Y_OFFSET,
    LARGE_FURNACE_HEIGHT,
    LARGE_FURNACE_RENDER_Y_OFFSET,
    FURNACE_HEIGHT,
    FURNACE_RENDER_Y_OFFSET,
} from '../utils/renderers/furnaceRenderingUtils';
import { PLAYER_FUMAROLE_INTERACTION_DISTANCE_SQUARED } from '../utils/renderers/fumaroleRenderingUtils';
import { PLAYER_STASH_INTERACTION_DISTANCE_SQUARED } from '../utils/renderers/stashRenderingUtils';
import { PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED } from '../utils/renderers/playerCorpseRenderingUtils';
import {
    PLAYER_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED,
    PLAYER_MONUMENT_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED,
} from '../utils/renderers/rainCollectorRenderingUtils';
import { isCompoundMonument } from '../config/compoundBuildings';

interface UseInteractionAutoCloseProps {
    interactingWith: InteractionTarget;
    handleSetInteractingWith: (target: InteractionTarget) => void;
    connectionIdentity: Identity | undefined;
    players: Map<string, Player>;
    woodenStorageBoxes: Map<string, WoodenStorageBox>;
    campfires: Map<string, Campfire>;
    furnaces: Map<string, Furnace>;
    fumaroles: Map<string, Fumarole>;
    stashes: Map<string, Stash>;
    playerCorpses: Map<string, PlayerCorpse>;
    rainCollectors: Map<string, RainCollector>;
}

/** Auto-close delay in ms to prevent immediate clearing when interaction is first set */
const AUTO_CLOSE_DELAY_MS = 100;

/** Buffer multiplier on distance thresholds so auto-close is more lenient than open */
const AUTO_CLOSE_BUFFER = 1.5;
/** Wooden storage boxes use 1.0 so UI closes before server would reject (server and client must match) */
const WOODEN_STORAGE_BOX_AUTO_CLOSE_BUFFER = 1.0;
/** Beehives (wild + player) use 1.4 - they close too aggressively otherwise (tall sprites, interaction from bottom) */
const BEEHIVE_AUTO_CLOSE_BUFFER = 1.4;

/**
 * Check if the player is within auto-close range of the entity they're interacting with.
 * Returns true if the player is OUT of range (should close), false if in range (stay open).
 * 
 * Uses the same asymmetric logic as the interaction target runtime for furnaces to ensure
 * consistency: if the blue box is visible, the UI must stay open.
 */
function isPlayerOutOfRange(
    playerX: number,
    playerY: number,
    interactingWith: NonNullable<InteractionTarget>,
    containers: Pick<UseInteractionAutoCloseProps, 'woodenStorageBoxes' | 'campfires' | 'furnaces' | 'fumaroles' | 'stashes' | 'playerCorpses' | 'rainCollectors'>
): boolean | null {
    const id = interactingWith.id.toString();

    switch (interactingWith.type) {
        case 'wooden_storage_box': {
            const box = containers.woodenStorageBoxes.get(id);
            if (!box) return null;
            
            // Compound monument cooking stations / repair benches / compost use monument interaction distance
            const isCompoundBldg = isCompoundMonument(box.isMonument, box.posX, box.posY);
            const isMonumentBuilding = isCompoundBldg && (box.boxType === BOX_TYPE_COOKING_STATION || box.boxType === BOX_TYPE_REPAIR_BENCH || box.boxType === BOX_TYPE_COMPOST);
            
            let centerY: number;
            let maxDistSq: number;
            
            if (isMonumentBuilding) {
                // Monument buildings: 384px sprite with 96px anchor offset
                const h = box.boxType === BOX_TYPE_COOKING_STATION ? MONUMENT_COOKING_STATION_HEIGHT : box.boxType === BOX_TYPE_COMPOST ? MONUMENT_COMPOST_HEIGHT : MONUMENT_REPAIR_BENCH_HEIGHT;
                const anchorOffset = 96;
                centerY = box.posY - h + anchorOffset + h / 2;
                maxDistSq = PLAYER_MONUMENT_BOX_INTERACTION_DISTANCE_SQUARED;
            } else {
                const dims = getBoxDimensions(box.boxType);
                centerY = box.posY - (dims.height / 2) - 20;
                const isBeehive = box.boxType === BOX_TYPE_PLAYER_BEEHIVE || box.boxType === BOX_TYPE_WILD_BEEHIVE;
                const isTallBox = box.boxType === BOX_TYPE_REPAIR_BENCH || box.boxType === BOX_TYPE_COOKING_STATION || box.boxType === BOX_TYPE_COMPOST || box.boxType === BOX_TYPE_TANNING_RACK;
                maxDistSq = isBeehive ? PLAYER_BEEHIVE_INTERACTION_DISTANCE_SQUARED
                    : isTallBox ? PLAYER_TALL_BOX_INTERACTION_DISTANCE_SQUARED
                    : PLAYER_BOX_INTERACTION_DISTANCE_SQUARED;
            }
            
            const dx = playerX - box.posX;
            const dy = playerY - centerY;
            // Beehives need more lenient buffer - tall sprites, interaction from bottom, often close too soon
            const buffer = (box.boxType === BOX_TYPE_PLAYER_BEEHIVE || box.boxType === BOX_TYPE_WILD_BEEHIVE)
                ? BEEHIVE_AUTO_CLOSE_BUFFER
                : WOODEN_STORAGE_BOX_AUTO_CLOSE_BUFFER;
            return (dx * dx + dy * dy) > maxDistSq * buffer;
        }

        case 'campfire': {
            const campfire = containers.campfires.get(id);
            if (!campfire) return null;
            const centerY = campfire.posY - (CAMPFIRE_HEIGHT / 2) - CAMPFIRE_RENDER_Y_OFFSET;
            const dx = playerX - campfire.posX;
            const dy = playerY - centerY;
            return (dx * dx + dy * dy) > PLAYER_CAMPFIRE_INTERACTION_DISTANCE_SQUARED * AUTO_CLOSE_BUFFER;
        }

        case 'furnace': {
            const furnace = containers.furnaces.get(id);
            if (!furnace) return null;

            const isLargeFurnace = furnace.furnaceType === FURNACE_TYPE_LARGE;
            const isCompoundFurnace = isCompoundMonument(furnace.isMonument, furnace.posX, furnace.posY);

            // Determine furnace dimensions (same as interaction target runtime)
            const furnaceHeight = isLargeFurnace
                ? (isCompoundFurnace ? MONUMENT_LARGE_FURNACE_HEIGHT : LARGE_FURNACE_HEIGHT)
                : FURNACE_HEIGHT;
            const furnaceYOffset = isLargeFurnace
                ? (isCompoundFurnace ? MONUMENT_LARGE_FURNACE_RENDER_Y_OFFSET : LARGE_FURNACE_RENDER_Y_OFFSET)
                : FURNACE_RENDER_Y_OFFSET;

            // Asymmetric interaction center — MUST match interaction target runtime
            let interactionCenterY: number;
            if (playerY > furnace.posY) {
                // Player below furnace: use lower interaction point
                const belowOffset = isLargeFurnace ? (isCompoundFurnace ? 80 : 40) : 10;
                interactionCenterY = furnace.posY + belowOffset;
            } else {
                // Player above furnace: use visual center
                interactionCenterY = furnace.posY - (furnaceHeight / 2) - furnaceYOffset;
            }

            // Select threshold (same as interaction target runtime)
            let maxDistSq: number;
            if (isCompoundFurnace && isLargeFurnace) {
                maxDistSq = PLAYER_MONUMENT_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED;
            } else if (isLargeFurnace) {
                maxDistSq = PLAYER_LARGE_FURNACE_INTERACTION_DISTANCE_SQUARED;
            } else {
                maxDistSq = PLAYER_FURNACE_INTERACTION_DISTANCE_SQUARED;
            }

            const dx = playerX - furnace.posX;
            const dy = playerY - interactionCenterY;
            return (dx * dx + dy * dy) > maxDistSq * AUTO_CLOSE_BUFFER;
        }

        case 'fumarole': {
            const fumarole = containers.fumaroles.get(id);
            if (!fumarole) return null;
            const dx = playerX - fumarole.posX;
            const dy = playerY - fumarole.posY;
            return (dx * dx + dy * dy) > PLAYER_FUMAROLE_INTERACTION_DISTANCE_SQUARED * AUTO_CLOSE_BUFFER;
        }

        case 'stash': {
            const stash = containers.stashes.get(id);
            if (!stash) return null;
            const dx = playerX - stash.posX;
            const dy = playerY - stash.posY;
            return (dx * dx + dy * dy) > PLAYER_STASH_INTERACTION_DISTANCE_SQUARED * AUTO_CLOSE_BUFFER;
        }

        case 'player_corpse': {
            const corpse = containers.playerCorpses.get(id);
            if (!corpse) return null;
            const dx = playerX - corpse.posX;
            const dy = playerY - corpse.posY;
            return (dx * dx + dy * dy) > PLAYER_CORPSE_INTERACTION_DISTANCE_SQUARED * AUTO_CLOSE_BUFFER;
        }

        case 'rain_collector': {
            const rc = containers.rainCollectors.get(id);
            if (!rc) return null;
            const maxDistSq = isCompoundMonument(rc.isMonument, rc.posX, rc.posY)
                ? PLAYER_MONUMENT_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED
                : PLAYER_RAIN_COLLECTOR_INTERACTION_DISTANCE_SQUARED;
            const dx = playerX - rc.posX;
            const dy = playerY - rc.posY;
            return (dx * dx + dy * dy) > maxDistSq * AUTO_CLOSE_BUFFER;
        }

        default:
            return null;
    }
}

/**
 * Automatically clears the interaction target when the player moves too far
 * from the entity they're interacting with.
 */
export function useInteractionAutoClose({
    interactingWith,
    handleSetInteractingWith,
    connectionIdentity,
    players,
    woodenStorageBoxes,
    campfires,
    furnaces,
    fumaroles,
    stashes,
    playerCorpses,
    rainCollectors,
}: UseInteractionAutoCloseProps): void {
    useEffect(() => {
        const localPlayer = connectionIdentity ? players.get(connectionIdentity.toHexString()) : undefined;

        if (!localPlayer || !interactingWith) {
            return;
        }

        const timeoutId = setTimeout(() => {
            // Re-get player to ensure latest position
            const currentPlayer = connectionIdentity ? players.get(connectionIdentity.toHexString()) : undefined;
            if (!currentPlayer || !interactingWith) return;

            const outOfRange = isPlayerOutOfRange(
                currentPlayer.positionX,
                currentPlayer.positionY,
                interactingWith,
                { woodenStorageBoxes, campfires, furnaces, fumaroles, stashes, playerCorpses, rainCollectors }
            );

            if (outOfRange === true) {
                handleSetInteractingWith(null);
            }
        }, AUTO_CLOSE_DELAY_MS);

        return () => clearTimeout(timeoutId);
    }, [
        interactingWith,
        players,
        connectionIdentity,
        woodenStorageBoxes,
        campfires,
        furnaces,
        fumaroles,
        stashes,
        playerCorpses,
        rainCollectors,
        handleSetInteractingWith,
    ]);
}
