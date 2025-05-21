import { useState, useEffect, useRef } from 'react';
import * as SpacetimeDB from '../generated';
import { DbConnection } from '../generated'; // Import the connection type
import { getChunkIndicesForViewport } from '../utils/chunkUtils'; // Import the chunk utility

// Define the shape of the state returned by the hook
export interface SpacetimeTableStates {
    players: Map<string, SpacetimeDB.Player>;
    trees: Map<string, SpacetimeDB.Tree>;
    stones: Map<string, SpacetimeDB.Stone>;
    campfires: Map<string, SpacetimeDB.Campfire>;
    mushrooms: Map<string, SpacetimeDB.Mushroom>;
    corns: Map<string, SpacetimeDB.Corn>;
    pumpkins: Map<string, SpacetimeDB.Pumpkin>;
    hemps: Map<string, SpacetimeDB.Hemp>;
    itemDefinitions: Map<string, SpacetimeDB.ItemDefinition>;
    inventoryItems: Map<string, SpacetimeDB.InventoryItem>;
    worldState: SpacetimeDB.WorldState | null;
    activeEquipments: Map<string, SpacetimeDB.ActiveEquipment>;
    droppedItems: Map<string, SpacetimeDB.DroppedItem>;
    woodenStorageBoxes: Map<string, SpacetimeDB.WoodenStorageBox>;
    stashes: Map<string, SpacetimeDB.Stash>;
    recipes: Map<string, SpacetimeDB.Recipe>;
    craftingQueueItems: Map<string, SpacetimeDB.CraftingQueueItem>;
    messages: Map<string, SpacetimeDB.Message>;
    playerPins: Map<string, SpacetimeDB.PlayerPin>;
    activeConnections: Map<string, SpacetimeDB.ActiveConnection>;
    sleepingBags: Map<string, SpacetimeDB.SleepingBag>;
    playerCorpses: Map<string, SpacetimeDB.PlayerCorpse>;
    activeConsumableEffects: Map<string, SpacetimeDB.ActiveConsumableEffect>;
    localPlayerRegistered: boolean; // Flag indicating local player presence
    clouds: Map<string, SpacetimeDB.Cloud>; // <<< ADDED clouds to interface
}

// Define the props the hook accepts
interface UseSpacetimeTablesProps {
    connection: DbConnection | null;
    cancelPlacement: () => void; // Function to cancel placement mode
    viewport: { minX: number; minY: number; maxX: number; maxY: number } | null; // New viewport prop
}

// Helper type for subscription handles (adjust if SDK provides a specific type)
type SubscriptionHandle = { unsubscribe: () => void } | null;

export const useSpacetimeTables = ({
    connection,
    cancelPlacement,
    viewport, // Get viewport from props
}: UseSpacetimeTablesProps): SpacetimeTableStates => {
    // --- State Management for Tables ---
    const [players, setPlayers] = useState<Map<string, SpacetimeDB.Player>>(() => new Map());
    const [trees, setTrees] = useState<Map<string, SpacetimeDB.Tree>>(() => new Map());
    const [stones, setStones] = useState<Map<string, SpacetimeDB.Stone>>(() => new Map());
    const [campfires, setCampfires] = useState<Map<string, SpacetimeDB.Campfire>>(() => new Map());
    const [mushrooms, setMushrooms] = useState<Map<string, SpacetimeDB.Mushroom>>(() => new Map());
    const [corns, setCorns] = useState<Map<string, SpacetimeDB.Corn>>(() => new Map());
    const [pumpkins, setPumpkins] = useState<Map<string, SpacetimeDB.Pumpkin>>(() => new Map());
    const [hemps, setHemps] = useState<Map<string, SpacetimeDB.Hemp>>(() => new Map());
    const [itemDefinitions, setItemDefinitions] = useState<Map<string, SpacetimeDB.ItemDefinition>>(() => new Map());
    const [inventoryItems, setInventoryItems] = useState<Map<string, SpacetimeDB.InventoryItem>>(() => new Map());
    const [worldState, setWorldState] = useState<SpacetimeDB.WorldState | null>(null);
    const [activeEquipments, setActiveEquipments] = useState<Map<string, SpacetimeDB.ActiveEquipment>>(() => new Map());
    const [droppedItems, setDroppedItems] = useState<Map<string, SpacetimeDB.DroppedItem>>(() => new Map());
    const [woodenStorageBoxes, setWoodenStorageBoxes] = useState<Map<string, SpacetimeDB.WoodenStorageBox>>(() => new Map());
    const [recipes, setRecipes] = useState<Map<string, SpacetimeDB.Recipe>>(() => new Map());
    const [craftingQueueItems, setCraftingQueueItems] = useState<Map<string, SpacetimeDB.CraftingQueueItem>>(() => new Map());
    const [messages, setMessages] = useState<Map<string, SpacetimeDB.Message>>(() => new Map());
    const [localPlayerRegistered, setLocalPlayerRegistered] = useState<boolean>(false);
    const [playerPins, setPlayerPins] = useState<Map<string, SpacetimeDB.PlayerPin>>(() => new Map());
    const [activeConnections, setActiveConnections] = useState<Map<string, SpacetimeDB.ActiveConnection>>(() => new Map());
    const [sleepingBags, setSleepingBags] = useState<Map<string, SpacetimeDB.SleepingBag>>(() => new Map());
    const [playerCorpses, setPlayerCorpses] = useState<Map<string, SpacetimeDB.PlayerCorpse>>(() => new Map());
    const [stashes, setStashes] = useState<Map<string, SpacetimeDB.Stash>>(() => new Map());
    const [activeConsumableEffects, setActiveConsumableEffects] = useState<Map<string, SpacetimeDB.ActiveConsumableEffect>>(() => new Map());
    const [clouds, setClouds] = useState<Map<string, SpacetimeDB.Cloud>>(() => new Map()); // <<< ADDED clouds state

    // Ref to hold the cancelPlacement function
    const cancelPlacementRef = useRef(cancelPlacement);
    useEffect(() => { cancelPlacementRef.current = cancelPlacement; }, [cancelPlacement]);

    // Keep viewport in a ref for use in callbacks
    const viewportRef = useRef(viewport);
    useEffect(() => { viewportRef.current = viewport; }, [viewport]);

    // Track current chunk indices to avoid unnecessary resubscriptions
    const currentChunksRef = useRef<number[]>([]);
    
    // --- Refs for Subscription Management ---
    const nonSpatialHandlesRef = useRef<SubscriptionHandle[]>([]);
    // Store spatial subs per chunk index (RESTORED FROM WORKING VERSION)
    const spatialSubHandlesMapRef = useRef<Map<number, SubscriptionHandle[]>>(new Map()); 
    const callbacksRegisteredRef = useRef(false);
    
    // --- REMOVED Flag ---
    // const spatialSubscriptionsActiveRef = useRef(false);

    // Helper function for safely unsubscribing
    const safeUnsubscribe = (sub: SubscriptionHandle) => {
        if (sub) {
            try {
                sub.unsubscribe();
            } catch (e) {
                console.warn('[useSpacetimeTables] Error unsubscribing:', e);
            }
        }
    };

    // --- Effect for Subscriptions and Callbacks ---
    useEffect(() => {
        // --- Callback Registration & Initial Subscriptions (Only Once Per Connection Instance) ---
        if (connection && !callbacksRegisteredRef.current) {
            console.log("[useSpacetimeTables] ENTERING main useEffect for callbacks and initial subscriptions."); // ADDED LOG

            // --- Define Callbacks --- (Keep definitions here - Ensure all match the provided example if needed)
             
            // --- Player Subscriptions ---
            const handlePlayerInsert = (ctx: any, player: SpacetimeDB.Player) => {
                 // console.log('[useSpacetimeTables] handlePlayerInsert CALLED for:', player.username, player.identity.toHexString()); // Use identity
                 // Use identity.toHexString() as the key
                 setPlayers(prev => new Map(prev).set(player.identity.toHexString(), player)); 

                 // Determine local player registration status within the callback
                 const localPlayerIdHex = connection?.identity?.toHexString();
                 if (localPlayerIdHex && player.identity.toHexString() === localPlayerIdHex) {
                         // console.log('[useSpacetimeTables] Local player matched! Setting localPlayerRegistered = true.');
                         setLocalPlayerRegistered(true);
                 }
             };
            const handlePlayerUpdate = (ctx: any, oldPlayer: SpacetimeDB.Player, newPlayer: SpacetimeDB.Player) => {
                const playerHexId = newPlayer.identity.toHexString();
                
                // Log newPlayer's lastHitTime when a respawn might be happening
                if (oldPlayer.isDead && !newPlayer.isDead) {
                    console.log(`[useSpacetimeTables] handlePlayerUpdate: Respawn detected for ${playerHexId}. newPlayer.lastHitTime (raw object):`, newPlayer.lastHitTime);
                    console.log(`  newPlayer.lastHitTime converted to micros: ${newPlayer.lastHitTime ? newPlayer.lastHitTime.__timestamp_micros_since_unix_epoch__ : 'null'}`);
                    // console.log(`  newPlayer full object:`, JSON.parse(JSON.stringify(newPlayer))); // Can be too verbose
                }

                const EPSILON = 0.01;
                const posChanged = Math.abs(oldPlayer.positionX - newPlayer.positionX) > EPSILON || Math.abs(oldPlayer.positionY - newPlayer.positionY) > EPSILON;
                
                // Explicitly check if lastHitTime has changed
                const oldLastHitTimeMicros = oldPlayer.lastHitTime ? oldPlayer.lastHitTime.__timestamp_micros_since_unix_epoch__ : null;
                const newLastHitTimeMicros = newPlayer.lastHitTime ? newPlayer.lastHitTime.__timestamp_micros_since_unix_epoch__ : null;
                const lastHitTimeChanged = oldLastHitTimeMicros !== newLastHitTimeMicros;

                const statsChanged = Math.round(oldPlayer.health) !== Math.round(newPlayer.health) || Math.round(oldPlayer.stamina) !== Math.round(newPlayer.stamina) || Math.round(oldPlayer.hunger) !== Math.round(newPlayer.hunger) || Math.round(oldPlayer.thirst) !== Math.round(newPlayer.thirst) || Math.round(oldPlayer.warmth) !== Math.round(newPlayer.warmth);
                const stateChanged = oldPlayer.isSprinting !== newPlayer.isSprinting || oldPlayer.direction !== newPlayer.direction || oldPlayer.jumpStartTimeMs !== newPlayer.jumpStartTimeMs || oldPlayer.isDead !== newPlayer.isDead || oldPlayer.isTorchLit !== newPlayer.isTorchLit;
                const onlineStatusChanged = oldPlayer.isOnline !== newPlayer.isOnline;
                const usernameChanged = oldPlayer.username !== newPlayer.username;
                const colorChanged = oldPlayer.color !== newPlayer.color;

                if (posChanged || statsChanged || stateChanged || onlineStatusChanged || usernameChanged || colorChanged || lastHitTimeChanged) { 
                    if (lastHitTimeChanged) {
                         console.log(`[useSpacetimeTables] handlePlayerUpdate: lastHitTime CHANGED for ${playerHexId}. Old micros: ${oldLastHitTimeMicros}, New micros: ${newLastHitTimeMicros}`);
                    }
                    if (oldPlayer.isDead && !newPlayer.isDead && lastHitTimeChanged) {
                        console.log(`[useSpacetimeTables] handlePlayerUpdate: Respawn for ${playerHexId} also has lastHitTimeChanged. Old: ${oldLastHitTimeMicros}, New: ${newLastHitTimeMicros}. APPLYING UPDATE.`);
                    } else if (oldPlayer.isDead && !newPlayer.isDead && !lastHitTimeChanged) {
                        // This case should ideally not happen if server sends null for last_hit_time on respawn and SDK passes it through.
                        console.warn(`[useSpacetimeTables] handlePlayerUpdate: Respawn for ${playerHexId} BUT lastHitTime DID NOT CHANGE. Old: ${oldLastHitTimeMicros}, New: ${newLastHitTimeMicros}. This might be an issue.`);
                    }

                    setPlayers(prev => {
                        const newMap = new Map(prev);
                        newMap.set(playerHexId, newPlayer); // Use playerHexId here
                        // Optional: Log details of what's being set
                        // if (oldPlayer.isDead && !newPlayer.isDead) {
                        //     console.log(`[useSpacetimeTables] setPlayers (for respawn of ${playerHexId}): Updating map with lastHitTime: ${newPlayer.lastHitTime ? newPlayer.lastHitTime.__timestamp_micros_since_unix_epoch__ : 'null'}`);
                        // }
                        return newMap;
                    });
                }
            };
            const handlePlayerDelete = (ctx: any, deletedPlayer: SpacetimeDB.Player) => {
                // console.log('[useSpacetimeTables] Player Deleted:', deletedPlayer.username, deletedPlayer.identity.toHexString());
                setPlayers(prev => { const newMap = new Map(prev); newMap.delete(deletedPlayer.identity.toHexString()); return newMap; });
                if (connection && connection.identity && deletedPlayer.identity.isEqual(connection.identity)) {
                    if (localPlayerRegistered) {
                       console.warn('[useSpacetimeTables] Local player deleted from server.');
                       setLocalPlayerRegistered(false);
                    }
                }
            };
            
            // --- Tree Subscriptions ---
            const handleTreeInsert = (ctx: any, tree: SpacetimeDB.Tree) => setTrees(prev => new Map(prev).set(tree.id.toString(), tree));
            const handleTreeUpdate = (ctx: any, oldTree: SpacetimeDB.Tree, newTree: SpacetimeDB.Tree) => {
                const changed = oldTree.posX !== newTree.posX ||
                                oldTree.posY !== newTree.posY ||
                                oldTree.health !== newTree.health ||
                                oldTree.treeType !== newTree.treeType ||
                                oldTree.lastHitTime !== newTree.lastHitTime ||
                                oldTree.respawnAt !== newTree.respawnAt;
                if (changed) {
                    setTrees(prev => new Map(prev).set(newTree.id.toString(), newTree));
                }
            };
            const handleTreeDelete = (ctx: any, tree: SpacetimeDB.Tree) => setTrees(prev => { const newMap = new Map(prev); newMap.delete(tree.id.toString()); return newMap; });
            
            // --- Stone Subscriptions ---
            const handleStoneInsert = (ctx: any, stone: SpacetimeDB.Stone) => setStones(prev => new Map(prev).set(stone.id.toString(), stone));
            const handleStoneUpdate = (ctx: any, oldStone: SpacetimeDB.Stone, newStone: SpacetimeDB.Stone) => {
                const changed = oldStone.posX !== newStone.posX ||
                                oldStone.posY !== newStone.posY ||
                                oldStone.health !== newStone.health ||
                                oldStone.lastHitTime !== newStone.lastHitTime ||
                                oldStone.respawnAt !== newStone.respawnAt;
                if (changed) {
                    setStones(prev => new Map(prev).set(newStone.id.toString(), newStone));
                }
            };
            const handleStoneDelete = (ctx: any, stone: SpacetimeDB.Stone) => setStones(prev => { const newMap = new Map(prev); newMap.delete(stone.id.toString()); return newMap; });
            
            // --- Campfire Subscriptions ---
            const handleCampfireInsert = (ctx: any, campfire: SpacetimeDB.Campfire) => {
                setCampfires(prev => new Map(prev).set(campfire.id.toString(), campfire));
                if (connection.identity && campfire.placedBy.isEqual(connection.identity)) {
                   cancelPlacementRef.current();
               }
            };
            const handleCampfireUpdate = (ctx: any, oldFire: SpacetimeDB.Campfire, newFire: SpacetimeDB.Campfire) => setCampfires(prev => new Map(prev).set(newFire.id.toString(), newFire));
            const handleCampfireDelete = (ctx: any, campfire: SpacetimeDB.Campfire) => setCampfires(prev => { const newMap = new Map(prev); newMap.delete(campfire.id.toString()); return newMap; });
            
            // --- Item Definition Subscriptions ---
            const handleItemDefInsert = (ctx: any, itemDef: SpacetimeDB.ItemDefinition) => setItemDefinitions(prev => new Map(prev).set(itemDef.id.toString(), itemDef));
            const handleItemDefUpdate = (ctx: any, oldDef: SpacetimeDB.ItemDefinition, newDef: SpacetimeDB.ItemDefinition) => setItemDefinitions(prev => new Map(prev).set(newDef.id.toString(), newDef));
            const handleItemDefDelete = (ctx: any, itemDef: SpacetimeDB.ItemDefinition) => setItemDefinitions(prev => { const newMap = new Map(prev); newMap.delete(itemDef.id.toString()); return newMap; });
            
            // --- Inventory Subscriptions ---
            const handleInventoryInsert = (ctx: any, invItem: SpacetimeDB.InventoryItem) => setInventoryItems(prev => new Map(prev).set(invItem.instanceId.toString(), invItem));
            const handleInventoryUpdate = (ctx: any, oldItem: SpacetimeDB.InventoryItem, newItem: SpacetimeDB.InventoryItem) => setInventoryItems(prev => new Map(prev).set(newItem.instanceId.toString(), newItem));
            const handleInventoryDelete = (ctx: any, invItem: SpacetimeDB.InventoryItem) => setInventoryItems(prev => { const newMap = new Map(prev); newMap.delete(invItem.instanceId.toString()); return newMap; });
            
            // --- World State Subscriptions ---
            const handleWorldStateInsert = (ctx: any, state: SpacetimeDB.WorldState) => setWorldState(state);
            const handleWorldStateUpdate = (ctx: any, oldState: SpacetimeDB.WorldState, newState: SpacetimeDB.WorldState) => {
                const significantChange = oldState.timeOfDay !== newState.timeOfDay || oldState.isFullMoon !== newState.isFullMoon || oldState.cycleCount !== newState.cycleCount;
                if (significantChange) setWorldState(newState);
            };
            const handleWorldStateDelete = (ctx: any, state: SpacetimeDB.WorldState) => setWorldState(null);
            
            // --- Active Equipment Subscriptions ---
            const handleActiveEquipmentInsert = (ctx: any, equip: SpacetimeDB.ActiveEquipment) => setActiveEquipments(prev => new Map(prev).set(equip.playerIdentity.toHexString(), equip));
            const handleActiveEquipmentUpdate = (ctx: any, oldEquip: SpacetimeDB.ActiveEquipment, newEquip: SpacetimeDB.ActiveEquipment) => setActiveEquipments(prev => new Map(prev).set(newEquip.playerIdentity.toHexString(), newEquip));
            const handleActiveEquipmentDelete = (ctx: any, equip: SpacetimeDB.ActiveEquipment) => setActiveEquipments(prev => { const newMap = new Map(prev); newMap.delete(equip.playerIdentity.toHexString()); return newMap; });
            
            // --- Mushroom Subscriptions ---
            const handleMushroomInsert = (ctx: any, mushroom: SpacetimeDB.Mushroom) => setMushrooms(prev => new Map(prev).set(mushroom.id.toString(), mushroom));
            const handleMushroomUpdate = (ctx: any, oldMushroom: SpacetimeDB.Mushroom, newMushroom: SpacetimeDB.Mushroom) => {
                const changed = oldMushroom.posX !== newMushroom.posX ||
                                oldMushroom.posY !== newMushroom.posY ||
                                oldMushroom.respawnAt !== newMushroom.respawnAt;
                if (changed) {
                    setMushrooms(prev => new Map(prev).set(newMushroom.id.toString(), newMushroom));
                }
            };
            const handleMushroomDelete = (ctx: any, mushroom: SpacetimeDB.Mushroom) => setMushrooms(prev => { const newMap = new Map(prev); newMap.delete(mushroom.id.toString()); return newMap; });

            // --- Corn Subscriptions ---
            const handleCornInsert = (ctx: any, corn: SpacetimeDB.Corn) => setCorns(prev => new Map(prev).set(corn.id.toString(), corn));
            const handleCornUpdate = (ctx: any, oldCorn: SpacetimeDB.Corn, newCorn: SpacetimeDB.Corn) => {
                const changed = oldCorn.posX !== newCorn.posX ||
                                oldCorn.posY !== newCorn.posY ||
                                oldCorn.respawnAt !== newCorn.respawnAt;
                if (changed) {
                    setCorns(prev => new Map(prev).set(newCorn.id.toString(), newCorn));
                }
            };
            const handleCornDelete = (ctx: any, corn: SpacetimeDB.Corn) => setCorns(prev => { const newMap = new Map(prev); newMap.delete(corn.id.toString()); return newMap; });
            
            // --- Pumpkin Subscriptions ---
            const handlePumpkinInsert = (ctx: any, pumpkin: SpacetimeDB.Pumpkin) => setPumpkins(prev => new Map(prev).set(pumpkin.id.toString(), pumpkin));
            const handlePumpkinUpdate = (ctx: any, oldPumpkin: SpacetimeDB.Pumpkin, newPumpkin: SpacetimeDB.Pumpkin) => {
                const changed = oldPumpkin.posX !== newPumpkin.posX ||
                                oldPumpkin.posY !== newPumpkin.posY ||
                                oldPumpkin.respawnAt !== newPumpkin.respawnAt;
                if (changed) {
                    setPumpkins(prev => new Map(prev).set(newPumpkin.id.toString(), newPumpkin));
                }
            };
            const handlePumpkinDelete = (ctx: any, pumpkin: SpacetimeDB.Pumpkin) => setPumpkins(prev => { const newMap = new Map(prev); newMap.delete(pumpkin.id.toString()); return newMap; });

            // --- Hemp Subscriptions ---
            const handleHempInsert = (ctx: any, hemp: SpacetimeDB.Hemp) => setHemps(prev => new Map(prev).set(hemp.id.toString(), hemp));
            const handleHempUpdate = (ctx: any, oldHemp: SpacetimeDB.Hemp, newHemp: SpacetimeDB.Hemp) => {
                const changed = oldHemp.posX !== newHemp.posX ||
                                oldHemp.posY !== newHemp.posY ||
                                oldHemp.respawnAt !== newHemp.respawnAt;
                if (changed) {
                    setHemps(prev => new Map(prev).set(newHemp.id.toString(), newHemp));
                }
            };
            const handleHempDelete = (ctx: any, hemp: SpacetimeDB.Hemp) => setHemps(prev => { const newMap = new Map(prev); newMap.delete(hemp.id.toString()); return newMap; });
            
            // --- Dropped Item Subscriptions ---
            const handleDroppedItemInsert = (ctx: any, item: SpacetimeDB.DroppedItem) => setDroppedItems(prev => new Map(prev).set(item.id.toString(), item));
            const handleDroppedItemUpdate = (ctx: any, oldItem: SpacetimeDB.DroppedItem, newItem: SpacetimeDB.DroppedItem) => setDroppedItems(prev => new Map(prev).set(newItem.id.toString(), newItem));
            const handleDroppedItemDelete = (ctx: any, item: SpacetimeDB.DroppedItem) => setDroppedItems(prev => { const newMap = new Map(prev); newMap.delete(item.id.toString()); return newMap; });
            
            // --- Wooden Storage Box Subscriptions ---
            const handleWoodenStorageBoxInsert = (ctx: any, box: SpacetimeDB.WoodenStorageBox) => {
                setWoodenStorageBoxes(prev => new Map(prev).set(box.id.toString(), box));
                if (connection.identity && box.placedBy.isEqual(connection.identity)) {
                   cancelPlacementRef.current();
                }
            };
            const handleWoodenStorageBoxUpdate = (ctx: any, oldBox: SpacetimeDB.WoodenStorageBox, newBox: SpacetimeDB.WoodenStorageBox) => setWoodenStorageBoxes(prev => new Map(prev).set(newBox.id.toString(), newBox));
            const handleWoodenStorageBoxDelete = (ctx: any, box: SpacetimeDB.WoodenStorageBox) => setWoodenStorageBoxes(prev => { const newMap = new Map(prev); newMap.delete(box.id.toString()); return newMap; });
            
            // --- Recipe Subscriptions ---
            const handleRecipeInsert = (ctx: any, recipe: SpacetimeDB.Recipe) => setRecipes(prev => new Map(prev).set(recipe.recipeId.toString(), recipe));
            const handleRecipeUpdate = (ctx: any, oldRecipe: SpacetimeDB.Recipe, newRecipe: SpacetimeDB.Recipe) => setRecipes(prev => new Map(prev).set(newRecipe.recipeId.toString(), newRecipe));
            const handleRecipeDelete = (ctx: any, recipe: SpacetimeDB.Recipe) => setRecipes(prev => { const newMap = new Map(prev); newMap.delete(recipe.recipeId.toString()); return newMap; });
            
            // --- Crafting Queue Subscriptions ---
            const handleCraftingQueueInsert = (ctx: any, queueItem: SpacetimeDB.CraftingQueueItem) => setCraftingQueueItems(prev => new Map(prev).set(queueItem.queueItemId.toString(), queueItem));
            const handleCraftingQueueUpdate = (ctx: any, oldItem: SpacetimeDB.CraftingQueueItem, newItem: SpacetimeDB.CraftingQueueItem) => setCraftingQueueItems(prev => new Map(prev).set(newItem.queueItemId.toString(), newItem));
            const handleCraftingQueueDelete = (ctx: any, queueItem: SpacetimeDB.CraftingQueueItem) => setCraftingQueueItems(prev => { const newMap = new Map(prev); newMap.delete(queueItem.queueItemId.toString()); return newMap; });
            
            // --- Message Subscriptions ---
            const handleMessageInsert = (ctx: any, msg: SpacetimeDB.Message) => setMessages(prev => new Map(prev).set(msg.id.toString(), msg));
            const handleMessageUpdate = (ctx: any, oldMsg: SpacetimeDB.Message, newMsg: SpacetimeDB.Message) => setMessages(prev => new Map(prev).set(newMsg.id.toString(), newMsg));
            const handleMessageDelete = (ctx: any, msg: SpacetimeDB.Message) => setMessages(prev => { const newMap = new Map(prev); newMap.delete(msg.id.toString()); return newMap; });
            
            // --- Player Pin Subscriptions ---
            const handlePlayerPinInsert = (ctx: any, pin: SpacetimeDB.PlayerPin) => setPlayerPins(prev => new Map(prev).set(pin.playerId.toHexString(), pin));
            const handlePlayerPinUpdate = (ctx: any, oldPin: SpacetimeDB.PlayerPin, newPin: SpacetimeDB.PlayerPin) => setPlayerPins(prev => new Map(prev).set(newPin.playerId.toHexString(), newPin));
            const handlePlayerPinDelete = (ctx: any, pin: SpacetimeDB.PlayerPin) => setPlayerPins(prev => { const newMap = new Map(prev); newMap.delete(pin.playerId.toHexString()); return newMap; });
            
            // --- Active Connection Subscriptions ---
            const handleActiveConnectionInsert = (ctx: any, conn: SpacetimeDB.ActiveConnection) => {
                console.log(`[useSpacetimeTables LOG] ActiveConnection INSERT: ${conn.identity.toHexString()}`);
                setActiveConnections(prev => {
                    const newMap = new Map(prev).set(conn.identity.toHexString(), conn);
                    console.log(`[useSpacetimeTables LOG] activeConnections map AFTER INSERT:`, newMap);
                    return newMap;
                });
            };
            const handleActiveConnectionDelete = (ctx: any, conn: SpacetimeDB.ActiveConnection) => {
                 console.log(`[useSpacetimeTables LOG] ActiveConnection DELETE: ${conn.identity.toHexString()}`);
                setActiveConnections(prev => {
                    const newMap = new Map(prev);
                    newMap.delete(conn.identity.toHexString());
                    console.log(`[useSpacetimeTables LOG] activeConnections map AFTER DELETE:`, newMap);
                    return newMap;
                });
            };

            // --- Sleeping Bag Subscriptions ---
            const handleSleepingBagInsert = (ctx: any, bag: SpacetimeDB.SleepingBag) => {
                setSleepingBags(prev => new Map(prev).set(bag.id.toString(), bag));
                if (connection.identity && bag.placedBy.isEqual(connection.identity)) {
                   cancelPlacementRef.current();
                }
            };
            const handleSleepingBagUpdate = (ctx: any, oldBag: SpacetimeDB.SleepingBag, newBag: SpacetimeDB.SleepingBag) => {
                setSleepingBags(prev => new Map(prev).set(newBag.id.toString(), newBag));
            };
            const handleSleepingBagDelete = (ctx: any, bag: SpacetimeDB.SleepingBag) => {
                setSleepingBags(prev => { const newMap = new Map(prev); newMap.delete(bag.id.toString()); return newMap; });
            };

            // --- Player Corpse Subscriptions ---
            const handlePlayerCorpseInsert = (ctx: any, corpse: SpacetimeDB.PlayerCorpse) => {
                setPlayerCorpses(prev => new Map(prev).set(corpse.id.toString(), corpse));
            };
            const handlePlayerCorpseUpdate = (ctx: any, oldCorpse: SpacetimeDB.PlayerCorpse, newCorpse: SpacetimeDB.PlayerCorpse) => {
                setPlayerCorpses(prev => new Map(prev).set(newCorpse.id.toString(), newCorpse));
            };
            const handlePlayerCorpseDelete = (ctx: any, corpse: SpacetimeDB.PlayerCorpse) => {
                setPlayerCorpses(prev => { const newMap = new Map(prev); newMap.delete(corpse.id.toString()); return newMap; });
            };

            // --- Stash Subscriptions ---
            const handleStashInsert = (ctx: any, stash: SpacetimeDB.Stash) => {
                setStashes(prev => new Map(prev).set(stash.id.toString(), stash));
                if (connection.identity && stash.placedBy.isEqual(connection.identity)) {
                    cancelPlacementRef.current();
                }
            };
            const handleStashUpdate = (ctx: any, oldStash: SpacetimeDB.Stash, newStash: SpacetimeDB.Stash) => {
                setStashes(prev => new Map(prev).set(newStash.id.toString(), newStash));
            };
            const handleStashDelete = (ctx: any, stash: SpacetimeDB.Stash) => {
                setStashes(prev => { const newMap = new Map(prev); newMap.delete(stash.id.toString()); return newMap; });
            };
            
            // --- ActiveConsumableEffect Subscriptions ---
            const handleActiveConsumableEffectInsert = (ctx: any, effect: SpacetimeDB.ActiveConsumableEffect) => {
                // console.log("[useSpacetimeTables] handleActiveConsumableEffectInsert CALLED, effect:", effect);
                setActiveConsumableEffects(prev => new Map(prev).set(effect.effectId.toString(), effect));
            };
            const handleActiveConsumableEffectUpdate = (ctx: any, oldEffect: SpacetimeDB.ActiveConsumableEffect, newEffect: SpacetimeDB.ActiveConsumableEffect) => {
                // console.log("[useSpacetimeTables] handleActiveConsumableEffectUpdate CALLED, newEffect:", newEffect);
                setActiveConsumableEffects(prev => new Map(prev).set(newEffect.effectId.toString(), newEffect));
            };
            const handleActiveConsumableEffectDelete = (ctx: any, effect: SpacetimeDB.ActiveConsumableEffect) => {
                // console.log("[useSpacetimeTables] handleActiveConsumableEffectDelete CALLED, effect:", effect);
                setActiveConsumableEffects(prev => { const newMap = new Map(prev); newMap.delete(effect.effectId.toString()); return newMap; });
            };
            
            // --- Cloud Subscriptions ---
            const handleCloudInsert = (ctx: any, cloud: SpacetimeDB.Cloud) => {
                // console.log("[useSpacetimeTables] handleCloudInsert CALLED with cloud:", cloud); // ADDED LOG
                setClouds(prev => new Map(prev).set(cloud.id.toString(), cloud));
            };
            const handleCloudUpdate = (ctx: any, oldCloud: SpacetimeDB.Cloud, newCloud: SpacetimeDB.Cloud) => {
                // console.log("[useSpacetimeTables] handleCloudUpdate CALLED with newCloud:", newCloud); // ADDED LOG
                setClouds(prev => new Map(prev).set(newCloud.id.toString(), newCloud));
            };
            const handleCloudDelete = (ctx: any, cloud: SpacetimeDB.Cloud) => {
                // console.log("[useSpacetimeTables] handleCloudDelete CALLED for cloud ID:", cloud.id.toString()); // ADDED LOG
                setClouds(prev => { const newMap = new Map(prev); newMap.delete(cloud.id.toString()); return newMap; });
            };
            
            // --- Register Callbacks ---
            connection.db.player.onInsert(handlePlayerInsert); connection.db.player.onUpdate(handlePlayerUpdate); connection.db.player.onDelete(handlePlayerDelete);
            connection.db.tree.onInsert(handleTreeInsert); connection.db.tree.onUpdate(handleTreeUpdate); connection.db.tree.onDelete(handleTreeDelete);
            connection.db.stone.onInsert(handleStoneInsert); connection.db.stone.onUpdate(handleStoneUpdate); connection.db.stone.onDelete(handleStoneDelete);
            connection.db.campfire.onInsert(handleCampfireInsert); connection.db.campfire.onUpdate(handleCampfireUpdate); connection.db.campfire.onDelete(handleCampfireDelete);
            connection.db.itemDefinition.onInsert(handleItemDefInsert); connection.db.itemDefinition.onUpdate(handleItemDefUpdate); connection.db.itemDefinition.onDelete(handleItemDefDelete);
            connection.db.inventoryItem.onInsert(handleInventoryInsert); connection.db.inventoryItem.onUpdate(handleInventoryUpdate); connection.db.inventoryItem.onDelete(handleInventoryDelete);
            connection.db.worldState.onInsert(handleWorldStateInsert); connection.db.worldState.onUpdate(handleWorldStateUpdate); connection.db.worldState.onDelete(handleWorldStateDelete);
            connection.db.activeEquipment.onInsert(handleActiveEquipmentInsert); connection.db.activeEquipment.onUpdate(handleActiveEquipmentUpdate); connection.db.activeEquipment.onDelete(handleActiveEquipmentDelete);
            connection.db.mushroom.onInsert(handleMushroomInsert); connection.db.mushroom.onUpdate(handleMushroomUpdate); connection.db.mushroom.onDelete(handleMushroomDelete);
            connection.db.corn.onInsert(handleCornInsert); connection.db.corn.onUpdate(handleCornUpdate); connection.db.corn.onDelete(handleCornDelete);
            connection.db.pumpkin.onInsert(handlePumpkinInsert); connection.db.pumpkin.onUpdate(handlePumpkinUpdate); connection.db.pumpkin.onDelete(handlePumpkinDelete);
            connection.db.hemp.onInsert(handleHempInsert); connection.db.hemp.onUpdate(handleHempUpdate); connection.db.hemp.onDelete(handleHempDelete);
            connection.db.droppedItem.onInsert(handleDroppedItemInsert); connection.db.droppedItem.onUpdate(handleDroppedItemUpdate); connection.db.droppedItem.onDelete(handleDroppedItemDelete);
            connection.db.woodenStorageBox.onInsert(handleWoodenStorageBoxInsert); connection.db.woodenStorageBox.onUpdate(handleWoodenStorageBoxUpdate); connection.db.woodenStorageBox.onDelete(handleWoodenStorageBoxDelete);
            connection.db.recipe.onInsert(handleRecipeInsert); connection.db.recipe.onUpdate(handleRecipeUpdate); connection.db.recipe.onDelete(handleRecipeDelete);
            connection.db.craftingQueueItem.onInsert(handleCraftingQueueInsert); connection.db.craftingQueueItem.onUpdate(handleCraftingQueueUpdate); connection.db.craftingQueueItem.onDelete(handleCraftingQueueDelete);
            connection.db.message.onInsert(handleMessageInsert); connection.db.message.onUpdate(handleMessageUpdate); connection.db.message.onDelete(handleMessageDelete);
            connection.db.playerPin.onInsert(handlePlayerPinInsert); connection.db.playerPin.onUpdate(handlePlayerPinUpdate); connection.db.playerPin.onDelete(handlePlayerPinDelete);
            connection.db.activeConnection.onInsert(handleActiveConnectionInsert);
            connection.db.activeConnection.onDelete(handleActiveConnectionDelete);
            connection.db.sleepingBag.onInsert(handleSleepingBagInsert);
            connection.db.sleepingBag.onUpdate(handleSleepingBagUpdate);
            connection.db.sleepingBag.onDelete(handleSleepingBagDelete);
            connection.db.playerCorpse.onInsert(handlePlayerCorpseInsert);
            connection.db.playerCorpse.onUpdate(handlePlayerCorpseUpdate);
            connection.db.playerCorpse.onDelete(handlePlayerCorpseDelete);
            connection.db.stash.onInsert(handleStashInsert);
            connection.db.stash.onUpdate(handleStashUpdate);
            connection.db.stash.onDelete(handleStashDelete);
            console.log("[useSpacetimeTables] Attempting to register ActiveConsumableEffect callbacks."); // ADDED LOG
            connection.db.activeConsumableEffect.onInsert(handleActiveConsumableEffectInsert);
            connection.db.activeConsumableEffect.onUpdate(handleActiveConsumableEffectUpdate);
            connection.db.activeConsumableEffect.onDelete(handleActiveConsumableEffectDelete);
            
            // Register Cloud callbacks
            connection.db.cloud.onInsert(handleCloudInsert);
            connection.db.cloud.onUpdate(handleCloudUpdate);
            connection.db.cloud.onDelete(handleCloudDelete);

            callbacksRegisteredRef.current = true;

            // --- Create Initial Non-Spatial Subscriptions ---
            nonSpatialHandlesRef.current.forEach(sub => safeUnsubscribe(sub)); 
            nonSpatialHandlesRef.current = []; 
            
            // console.log("[useSpacetimeTables] Setting up initial non-spatial subscriptions.");
            const currentInitialSubs = [
                 connection.subscriptionBuilder()
                    // .onApplied(() => console.log("[useSpacetimeTables] Non-spatial PLAYER subscription applied.")) 
                    .onError((err) => console.error("[useSpacetimeTables] Non-spatial PLAYER subscription error:", err)) 
                    .subscribe('SELECT * FROM player'), 
                 connection.subscriptionBuilder().subscribe('SELECT * FROM item_definition'), 
                 connection.subscriptionBuilder().subscribe('SELECT * FROM recipe'), 
                 connection.subscriptionBuilder().subscribe('SELECT * FROM world_state'), 
                 connection.subscriptionBuilder()
                    // .onApplied(() => console.log("[useSpacetimeTables] Non-spatial INVENTORY subscription applied.")) 
                    .onError((err) => console.error("[useSpacetimeTables] Non-spatial INVENTORY subscription error:", err))
                    .subscribe('SELECT * FROM inventory_item'), 
                 connection.subscriptionBuilder()
                    // .onApplied(() => console.log("[useSpacetimeTables] Non-spatial EQUIPMENT subscription applied.")) 
                    .onError((err) => console.error("[useSpacetimeTables] Non-spatial EQUIPMENT subscription error:", err))
                    .subscribe('SELECT * FROM active_equipment'), 
                 connection.subscriptionBuilder()
                    // .onApplied(() => console.log("[useSpacetimeTables] Non-spatial CRAFTING subscription applied.")) 
                    .onError((err) => console.error("[useSpacetimeTables] Non-spatial CRAFTING subscription error:", err))
                    .subscribe('SELECT * FROM crafting_queue_item'), 
                 connection.subscriptionBuilder()
                    // .onApplied(() => console.log("[useSpacetimeTables] Non-spatial MESSAGE subscription applied.")) 
                    .onError((err) => console.error("[useSpacetimeTables] Non-spatial MESSAGE subscription error:", err))
                    .subscribe('SELECT * FROM message'), 
                 connection.subscriptionBuilder()
                    .onError((err) => console.error("[useSpacetimeTables] Non-spatial PLAYER_PIN subscription error:", err))
                    .subscribe('SELECT * FROM player_pin'),
                 connection.subscriptionBuilder()
                    .onError((err) => console.error("[useSpacetimeTables] Non-spatial ACTIVE_CONNECTION subscription error:", err))
                    .subscribe('SELECT * FROM active_connection'),
                 // ADD Non-Spatial SleepingBag subscription
                 connection.subscriptionBuilder()
                    .onError((err) => console.error("[useSpacetimeTables] Non-spatial SLEEPING_BAG subscription error:", err))
                    .subscribe('SELECT * FROM sleeping_bag'),
                 connection.subscriptionBuilder()
                    .onError((err) => console.error("[useSpacetimeTables] Non-spatial PLAYER_CORPSE subscription error:", err))
                    .subscribe('SELECT * FROM player_corpse'),
                 connection.subscriptionBuilder() // Added Stash subscription
                    .onError((err) => console.error("[useSpacetimeTables] Non-spatial STASH subscription error:", err))
                    .subscribe('SELECT * FROM stash'),
                 connection.subscriptionBuilder() // Added for ActiveConsumableEffect
                    .onApplied(() => console.log("[useSpacetimeTables] Subscription for 'active_consumable_effect' APPLIED."))
                    .onError((err) => console.error("[useSpacetimeTables] Subscription for 'active_consumable_effect' ERROR:", err))
                    .subscribe('SELECT * FROM active_consumable_effect'),
                 // connection.subscriptionBuilder() // Specific Cloud subscription with logging
                 //    .onApplied(() => console.log("[useSpacetimeTables] Subscription for 'cloud' APPLIED."))
                 //    .onError((errorContext) => console.error("[useSpacetimeTables] Subscription for 'cloud' Full Error Context:", errorContext)) // Log the entire context object
                 //    .subscribe('SELECT * FROM cloud'),
            ];
            console.log("[useSpacetimeTables] currentInitialSubs content:", currentInitialSubs); // ADDED LOG
            nonSpatialHandlesRef.current = currentInitialSubs;
        }

        // --- START RESTORED SPATIAL SUBSCRIPTION LOGIC ---
        if (connection && viewport) {
            // console.log("[DEBUG] Spatial Sub Effect Triggered. Viewport:", JSON.stringify(viewport)); // Log viewport
            // Get new viewport chunk indices
            const newChunkIndicesSet = new Set(getChunkIndicesForViewport(viewport));
            const currentChunkIndicesSet = new Set(currentChunksRef.current);
            // console.log("[DEBUG] Current Chunks:", currentChunksRef.current, "New Chunks Set:", newChunkIndicesSet); // Log chunks

            if (newChunkIndicesSet.size === 0) {
                // console.log("[useSpacetimeTables] No chunk indices in viewport range. Skipping spatial subscriptions.");
                // If viewport is empty, ensure all spatial subs are cleaned up
                if (currentChunkIndicesSet.size > 0) {
                     console.log("[useSpacetimeTables] Viewport empty, cleaning up all spatial subs.");
                     for (const chunkIdx of currentChunkIndicesSet) {
                         const handles = spatialSubHandlesMapRef.current.get(chunkIdx) || [];
                         handles.forEach(safeUnsubscribe);
                     }
                     spatialSubHandlesMapRef.current.clear();
                     currentChunksRef.current = [];
                }
                // No return here, allow cleanup logic below to run if connection is lost later
            } else {
                // Calculate differences only if new chunks are needed
                const addedChunks = [...newChunkIndicesSet].filter(idx => !currentChunkIndicesSet.has(idx));
                const removedChunks = [...currentChunkIndicesSet].filter(idx => !newChunkIndicesSet.has(idx));

                // Only proceed if there are actual changes
                if (addedChunks.length > 0 || removedChunks.length > 0) {
                    // console.log(`[DEBUG] Spatial Update Needed! Added: [${addedChunks.join(',')}] Removed: [${removedChunks.join(',')}]`); // Log diff
                    console.log(`[Sub Update] Added: [${addedChunks.join(',')}] Removed: [${removedChunks.join(',')}]`);

                    // --- Unsubscribe from Removed Chunks ---
                    removedChunks.forEach(chunkIndex => {
                        const handles = spatialSubHandlesMapRef.current.get(chunkIndex);
                        if (handles) {
                            // console.log(`[Sub Update] Unsubscribing from chunk ${chunkIndex}`);
                            handles.forEach(safeUnsubscribe);
                            spatialSubHandlesMapRef.current.delete(chunkIndex);
                        }
                    });

                    // --- Subscribe to Added Chunks ---
                    addedChunks.forEach(chunkIndex => {
                        // console.log(`[Sub Update] Subscribing to chunk ${chunkIndex}`);
                        const newHandlesForChunk: SubscriptionHandle[] = [];
                        try {
                            // Tree
                            const treeQuery = `SELECT * FROM tree WHERE chunk_index = ${chunkIndex}`;
                            newHandlesForChunk.push(connection.subscriptionBuilder().onError((err) => console.error(`Tree Sub Error (Chunk ${chunkIndex}):`, err)).subscribe(treeQuery));
                            // Stone
                            const stoneQuery = `SELECT * FROM stone WHERE chunk_index = ${chunkIndex}`;
                            newHandlesForChunk.push(connection.subscriptionBuilder().onError((err) => console.error(`Stone Sub Error (Chunk ${chunkIndex}):`, err)).subscribe(stoneQuery));
                            // Mushroom
                            const mushroomQuery = `SELECT * FROM mushroom WHERE chunk_index = ${chunkIndex}`;
                            newHandlesForChunk.push(connection.subscriptionBuilder().onError((err) => console.error(`Mushroom Sub Error (Chunk ${chunkIndex}):`, err)).subscribe(mushroomQuery));
                            // Corn
                            const cornQuery = `SELECT * FROM corn WHERE chunk_index = ${chunkIndex}`;
                            newHandlesForChunk.push(connection.subscriptionBuilder().onError((err) => console.error(`Corn Sub Error (Chunk ${chunkIndex}):`, err)).subscribe(cornQuery));
                            // Pumpkin
                            const pumpkinQuery = `SELECT * FROM pumpkin WHERE chunk_index = ${chunkIndex}`;
                            newHandlesForChunk.push(connection.subscriptionBuilder().onError((err) => console.error(`Pumpkin Sub Error (Chunk ${chunkIndex}):`, err)).subscribe(pumpkinQuery));
                            // Hemp
                            const hempQuery = `SELECT * FROM hemp WHERE chunk_index = ${chunkIndex}`;
                            newHandlesForChunk.push(connection.subscriptionBuilder().onError((err) => console.error(`Hemp Sub Error (Chunk ${chunkIndex}):`, err)).subscribe(hempQuery));
                            // Campfire
                            const campfireQuery = `SELECT * FROM campfire WHERE chunk_index = ${chunkIndex}`;
                            newHandlesForChunk.push(connection.subscriptionBuilder().onError((err) => console.error(`Campfire Sub Error (Chunk ${chunkIndex}):`, err)).subscribe(campfireQuery));
                            // WoodenStorageBox
                            const boxQuery = `SELECT * FROM wooden_storage_box WHERE chunk_index = ${chunkIndex}`;
                            newHandlesForChunk.push(connection.subscriptionBuilder().onError((err) => console.error(`Box Sub Error (Chunk ${chunkIndex}):`, err)).subscribe(boxQuery));
                            // DroppedItem
                            const droppedItemQuery = `SELECT * FROM dropped_item WHERE chunk_index = ${chunkIndex}`;
                            newHandlesForChunk.push(connection.subscriptionBuilder().onError((err) => console.error(`DroppedItem Sub Error (Chunk ${chunkIndex}):`, err)).subscribe(droppedItemQuery));
                            // SleepingBag - REMOVED spatial subscription
                            // const sleepingBagQuery = `SELECT * FROM sleeping_bag WHERE chunk_index = ${chunkIndex}`;
                            // newHandlesForChunk.push(connection.subscriptionBuilder().onError((err) => console.error(`SleepingBag Sub Error (Chunk ${chunkIndex}):`, err)).subscribe(sleepingBagQuery));

                            // Cloud (Spatial Subscription)
                            const cloudQuery = `SELECT * FROM cloud WHERE chunk_index = ${chunkIndex}`;
                            newHandlesForChunk.push(connection.subscriptionBuilder().onError((err) => console.error(`Cloud Sub Error (Chunk ${chunkIndex}):`, err)).subscribe(cloudQuery));

                            spatialSubHandlesMapRef.current.set(chunkIndex, newHandlesForChunk);
                        } catch (error) {
                            console.error(`[useSpacetimeTables] Error creating subscriptions for chunk ${chunkIndex}:`, error);
                            // Attempt to clean up any partial subscriptions for this chunk if error occurred mid-way
                            newHandlesForChunk.forEach(safeUnsubscribe);
                        }
                    });
                    
                    // Update the current chunk reference
                    currentChunksRef.current = [...newChunkIndicesSet]; // Store as array
                } else {
                    // console.log(`[useSpacetimeTables] Chunk set unchanged. Skipping subscription update.`);
                }
            }
            
        } else if (!viewport) {
            // If viewport becomes null, clean up ALL spatial subs
            // console.log("[DEBUG] Spatial Sub Effect - Viewport is NULL. Cleaning up spatial subs."); // Log cleanup trigger
            if (spatialSubHandlesMapRef.current.size > 0) {
                console.log("[useSpacetimeTables] Viewport removed. Cleaning up all spatial subscriptions."); // Updated log
                spatialSubHandlesMapRef.current.forEach((handles) => {
                    handles.forEach(safeUnsubscribe);
                });
                spatialSubHandlesMapRef.current.clear();
                currentChunksRef.current = [];
            }
        }
        // --- END RESTORED SPATIAL SUBSCRIPTION LOGIC ---

        // --- Cleanup Function --- 
        return () => {
             const isConnectionLost = !connection; 
             // console.log(`[useSpacetimeTables] Running cleanup. Connection Lost: ${isConnectionLost}, Viewport was present: ${!!viewport}`);

             if (isConnectionLost) {
                 // console.log("[useSpacetimeTables] Cleanup due to connection loss: Unsubscribing non-spatial & all spatial, resetting state.");
                 nonSpatialHandlesRef.current.forEach(sub => safeUnsubscribe(sub));
                 nonSpatialHandlesRef.current = [];
                 
                 // Unsubscribe all remaining spatial subs on connection loss
                 spatialSubHandlesMapRef.current.forEach((handles) => { // Use the map ref here
                    handles.forEach(safeUnsubscribe);
                 });
                 spatialSubHandlesMapRef.current.clear(); 
                
                 callbacksRegisteredRef.current = false;
                 currentChunksRef.current = [];
                 setLocalPlayerRegistered(false);
                 // Reset table states
                 setPlayers(new Map()); setTrees(new Map()); setStones(new Map()); setCampfires(new Map());
                 setMushrooms(new Map()); setItemDefinitions(new Map()); setRecipes(new Map());
                 setInventoryItems(new Map()); setWorldState(null); setActiveEquipments(new Map());
                 setDroppedItems(new Map()); setWoodenStorageBoxes(new Map()); setCraftingQueueItems(new Map());
                 setMessages(new Map());
                 setPlayerPins(new Map());
                 setActiveConnections(new Map());
                 setSleepingBags(new Map());
                 setPlayerCorpses(new Map());
                 setStashes(new Map());
                 setActiveConsumableEffects(new Map());
                 setClouds(new Map()); // <<< ADDED: Reset clouds state
             }
        };

    }, [connection, viewport]); 

    // --- Return Hook State ---
    return {
        players,
        trees,
        stones,
        campfires,
        mushrooms,
        corns,
        pumpkins,
        hemps,
        itemDefinitions,
        inventoryItems,
        worldState,
        activeEquipments,
        droppedItems,
        woodenStorageBoxes,
        recipes,
        craftingQueueItems,
        messages,
        localPlayerRegistered,
        playerPins,
        activeConnections,
        sleepingBags,
        playerCorpses,
        stashes,
        activeConsumableEffects,
        clouds, // <<< ADDED: Return clouds state
    };
}; 