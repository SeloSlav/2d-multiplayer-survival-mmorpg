import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ItemDefinition, InventoryItem, DbConnection, Campfire as SpacetimeDBCampfire, HotbarLocationData, EquipmentSlotType, Stash, Player, ActiveConsumableEffect, ActiveEquipment } from '../generated';
import { Identity, Timestamp } from '@clockworklabs/spacetimedb-sdk';

// Import Custom Components
import DraggableItem from './DraggableItem';
import DroppableSlot from './DroppableSlot';

// Import shared types
import { PopulatedItem } from './InventoryUI';
import { DragSourceSlotInfo, DraggedItemInfo } from '../types/dragDropTypes';
import { PlacementItemInfo } from '../hooks/usePlacementManager';

// Style constants similar to PlayerUI
const UI_BG_COLOR = 'rgba(40, 40, 60, 0.85)';
const UI_BORDER_COLOR = '#a0a0c0';
const UI_SHADOW = '2px 2px 0px rgba(0,0,0,0.5)';
const UI_FONT_FAMILY = '"Press Start 2P", cursive';
const SLOT_SIZE = 60; // Size of each hotbar slot in pixels
const SLOT_MARGIN = 6;
const SELECTED_BORDER_COLOR = '#ffffff';
const CONSUMPTION_COOLDOWN_MICROS = 1_000_000; // 1 second, matches server
const DEFAULT_CLIENT_ANIMATION_DURATION_MS = CONSUMPTION_COOLDOWN_MICROS / 1000; // Duration for client animation
const BANDAGE_CLIENT_ANIMATION_DURATION_MS = 5000; // 5 seconds for bandage visual cooldown

// Weapon cooldown state interface - simplified
interface WeaponCooldownState {
  slotIndex: number;
  startTime: number;
  duration: number;
}

// Update HotbarProps
interface HotbarProps {
  playerIdentity: Identity | null;
  localPlayer: Player | null;
  itemDefinitions: Map<string, ItemDefinition>;
  inventoryItems: Map<string, InventoryItem>;
  connection: DbConnection | null;
  onItemDragStart: (info: DraggedItemInfo) => void;
  onItemDrop: (targetSlotInfo: DragSourceSlotInfo | null) => void;
  draggedItemInfo: DraggedItemInfo | null;
  interactingWith: { type: string; id: number | bigint } | null;
  campfires: Map<string, SpacetimeDBCampfire>;
  stashes: Map<string, Stash>;
  startPlacement: (itemInfo: PlacementItemInfo) => void;
  cancelPlacement: () => void;
  activeConsumableEffects: Map<string, ActiveConsumableEffect>;
  activeEquipment: ActiveEquipment | null;
}

// --- Hotbar Component ---
const Hotbar: React.FC<HotbarProps> = ({
    playerIdentity,
    localPlayer,
    itemDefinitions,
    inventoryItems,
    connection,
    onItemDragStart,
    onItemDrop,
    interactingWith,
    stashes,
    startPlacement,
    cancelPlacement,
    activeConsumableEffects,
    activeEquipment,
}) => {
  // console.log('[Hotbar] Rendering. CLIENT_ANIMATION_DURATION_MS:', CLIENT_ANIMATION_DURATION_MS); // Added log
  const [selectedSlot, setSelectedSlot] = useState<number>(0);
  const [isVisualCooldownActive, setIsVisualCooldownActive] = useState<boolean>(false);
  const [visualCooldownStartTime, setVisualCooldownStartTime] = useState<number | null>(null);
  const [animationProgress, setAnimationProgress] = useState<number>(0);
  const [currentAnimationDuration, setCurrentAnimationDuration] = useState<number>(DEFAULT_CLIENT_ANIMATION_DURATION_MS);
  const [cooldownSlot, setCooldownSlot] = useState<number | null>(null); // Track which slot has the active cooldown
  const [forceRender, setForceRender] = useState<number>(0); // Force re-render counter
  
  // Weapon cooldown state - simplified to match consumable system
  const [isWeaponCooldownActive, setIsWeaponCooldownActive] = useState<boolean>(false);
  const [weaponCooldownStartTime, setWeaponCooldownStartTime] = useState<number | null>(null);
  const [weaponCooldownProgress, setWeaponCooldownProgress] = useState<number>(0);
  const [weaponCooldownDuration, setWeaponCooldownDuration] = useState<number>(1000);
  const [weaponCooldownSlot, setWeaponCooldownSlot] = useState<number | null>(null);
  
  const visualCooldownTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const weaponCooldownAnimationRef = useRef<number | null>(null);
  const weaponCooldownTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const numSlots = 6;
  const prevSelectedSlotRef = useRef<number>(selectedSlot);
  const prevActiveEffectsRef = useRef<Set<string>>(new Set());

  // Cleanup refs on unmount
  useEffect(() => {
    return () => {
      if (visualCooldownTimeoutRef.current) {
        clearTimeout(visualCooldownTimeoutRef.current);
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (weaponCooldownAnimationRef.current) {
        cancelAnimationFrame(weaponCooldownAnimationRef.current);
      }
      if (weaponCooldownTimeoutRef.current) {
        clearTimeout(weaponCooldownTimeoutRef.current);
      }
    };
  }, []);

  // Find item for slot - MOVED UP (and should be before animation useEffect)
  const findItemForSlot = useCallback((slotIndex: number): PopulatedItem | null => {
    if (!playerIdentity) return null;
    for (const itemInstance of inventoryItems.values()) {
      if (itemInstance.location.tag === 'Hotbar') {
        const hotbarData = itemInstance.location.value as HotbarLocationData;
        if (hotbarData.ownerId.isEqual(playerIdentity) && hotbarData.slotIndex === slotIndex) {
          const definition = itemDefinitions.get(itemInstance.itemDefId.toString());
          if (definition) {
              return { instance: itemInstance, definition };
          }
        }
      }
    }
    return null;
  }, [playerIdentity, inventoryItems, itemDefinitions]);

  // Helper function to check if an item is a weapon/tool with attack interval
  const isWeaponWithCooldown = useCallback((itemDef: ItemDefinition): boolean => {
    return itemDef.attackIntervalSecs !== null && 
           itemDef.attackIntervalSecs !== undefined && 
           itemDef.attackIntervalSecs > 0 &&
           (itemDef.category.tag === 'Weapon' || 
            itemDef.category.tag === 'RangedWeapon' || 
            itemDef.category.tag === 'Tool') &&
           itemDef.isEquippable;
  }, []);

  // Effect to track weapon cooldowns based on activeEquipment swingStartTimeMs - simplified
  useEffect(() => {
    // console.log('[Hotbar] Weapon cooldown useEffect triggered. activeEquipment:', activeEquipment);
    
    if (!activeEquipment || !playerIdentity) {
      // console.log('[Hotbar] No activeEquipment or playerIdentity, skipping weapon cooldown tracking');
      return;
    }

    const now = Date.now();
    const swingStartTime = Number(activeEquipment.swingStartTimeMs);
    
    // console.log('[Hotbar] Weapon cooldown check - swingStartTime:', swingStartTime, 'now:', now, 'diff:', now - swingStartTime);
    
    // Only process if there was a recent swing (within last 10 seconds to avoid stale data)
    if (swingStartTime > 0 && (now - swingStartTime) < 10000) {
      // console.log('[Hotbar] Recent swing detected, checking for equipped item...');
      
      // Find which hotbar slot contains the equipped item
      if (activeEquipment.equippedItemInstanceId) {
        // console.log('[Hotbar] Looking for equipped item with ID:', activeEquipment.equippedItemInstanceId);
        
        for (let slotIndex = 0; slotIndex < numSlots; slotIndex++) {
          const itemInSlot = findItemForSlot(slotIndex);
          if (itemInSlot) {
            // console.log(`[Hotbar] Slot ${slotIndex}: ${itemInSlot.definition.name} (ID: ${itemInSlot.instance.instanceId})`);
            
            if (BigInt(itemInSlot.instance.instanceId) === activeEquipment.equippedItemInstanceId) {
              // console.log(`[Hotbar] Found equipped item in slot ${slotIndex}: ${itemInSlot.definition.name}`);
              
              if (isWeaponWithCooldown(itemInSlot.definition)) {
                // console.log(`[Hotbar] Item is weapon with cooldown. attackIntervalSecs:`, itemInSlot.definition.attackIntervalSecs);
                
                const attackIntervalMs = (itemInSlot.definition.attackIntervalSecs || 0) * 1000;
                const cooldownEndTime = swingStartTime + attackIntervalMs;
                
                // console.log(`[Hotbar] Cooldown timing - start: ${swingStartTime}, duration: ${attackIntervalMs}ms, end: ${cooldownEndTime}, now: ${now}`);
                
                // Only start cooldown if it's still active
                if (now < cooldownEndTime) {
                  // console.log(`[Hotbar] Starting weapon cooldown for ${itemInSlot.definition.name} in slot ${slotIndex}, duration: ${attackIntervalMs}ms`);
                  
                  // Clear any existing weapon cooldown
                  if (weaponCooldownTimeoutRef.current) {
                    clearTimeout(weaponCooldownTimeoutRef.current);
                  }
                  
                  // Start weapon cooldown using the same pattern as consumables
                  setIsWeaponCooldownActive(true);
                  setWeaponCooldownStartTime(swingStartTime);
                  setWeaponCooldownProgress(0);
                  setWeaponCooldownDuration(attackIntervalMs);
                  setWeaponCooldownSlot(slotIndex);
                  
                  // Set timeout to clear weapon cooldown when it expires
                  const remainingTime = cooldownEndTime - now;
                  weaponCooldownTimeoutRef.current = setTimeout(() => {
                    // console.log('[Hotbar] Weapon cooldown timeout completed for slot:', slotIndex);
                    setIsWeaponCooldownActive(false);
                    setWeaponCooldownStartTime(null);
                    setWeaponCooldownProgress(0);
                    setWeaponCooldownSlot(null);
                  }, remainingTime);
                  
                } else {
                  // console.log('[Hotbar] Cooldown already expired, not starting animation');
                }
              } else {
                // console.log(`[Hotbar] Item ${itemInSlot.definition.name} is not a weapon with cooldown`);
              }
              break;
            }
          }
        }
      } else {
        // console.log('[Hotbar] No equippedItemInstanceId in activeEquipment');
      }
    } else {
      // console.log('[Hotbar] No recent swing or invalid swingStartTime');
    }
  }, [activeEquipment, findItemForSlot, isWeaponWithCooldown, playerIdentity, numSlots]);

  // Weapon cooldown animation loop - simplified to match consumable system
  useEffect(() => {
    if (isWeaponCooldownActive && weaponCooldownStartTime !== null) {
      const animate = () => {
        if (weaponCooldownStartTime === null) { 
            if (weaponCooldownAnimationRef.current) cancelAnimationFrame(weaponCooldownAnimationRef.current);
            setIsWeaponCooldownActive(false);
            setWeaponCooldownProgress(0);
            return;
        }
        const elapsedTimeMs = Date.now() - weaponCooldownStartTime;
        const currentProgress = Math.min(1, elapsedTimeMs / weaponCooldownDuration); 
        setWeaponCooldownProgress(currentProgress);
        
        // console.log(`[Hotbar] Weapon cooldown progress: ${(currentProgress * 100).toFixed(1)}%`);

        if (currentProgress < 1) {
          weaponCooldownAnimationRef.current = requestAnimationFrame(animate);
        } else {
          setIsWeaponCooldownActive(false);
          setWeaponCooldownStartTime(null);
          setWeaponCooldownProgress(0);
          setWeaponCooldownSlot(null);
        }
      };
      weaponCooldownAnimationRef.current = requestAnimationFrame(animate);
    } else {
      if (weaponCooldownAnimationRef.current) {
        cancelAnimationFrame(weaponCooldownAnimationRef.current);
        weaponCooldownAnimationRef.current = null;
      }
    }

    return () => {
      if (weaponCooldownAnimationRef.current) {
        cancelAnimationFrame(weaponCooldownAnimationRef.current);
        weaponCooldownAnimationRef.current = null;
      }
    };
  }, [isWeaponCooldownActive, weaponCooldownStartTime, weaponCooldownDuration]);

  // useEffect for the cooldown animation progress - MOVED AFTER findItemForSlot
  useEffect(() => {
    if (isVisualCooldownActive && visualCooldownStartTime !== null) {
      const animate = () => {
        if (visualCooldownStartTime === null) { 
            if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
            setIsVisualCooldownActive(false);
            setAnimationProgress(0);
            return;
        }
        const elapsedTimeMs = Date.now() - visualCooldownStartTime;
        const currentProgress = Math.min(1, elapsedTimeMs / currentAnimationDuration); 
        setAnimationProgress(currentProgress);
        
        // Debug logging removed for performance

        if (currentProgress < 1) {
          animationFrameRef.current = requestAnimationFrame(animate);
        } else {
          setIsVisualCooldownActive(false);
          setVisualCooldownStartTime(null);
          setAnimationProgress(0);
          setCurrentAnimationDuration(DEFAULT_CLIENT_ANIMATION_DURATION_MS);
          setCooldownSlot(null);
        }
      };
      animationFrameRef.current = requestAnimationFrame(animate);
    } else {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    }

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [isVisualCooldownActive, visualCooldownStartTime, currentAnimationDuration]); // Use stored duration instead of recalculating

  // Trigger client cooldown animation - simplified to work like other consumables
  const triggerClientCooldownAnimation = useCallback((isBandageEffect: boolean, slotToAnimate: number) => {
    console.log('[Hotbar] triggerClientCooldownAnimation called. IsBandage:', isBandageEffect, 'Animate Slot:', slotToAnimate);

    if (slotToAnimate < 0 || slotToAnimate >= numSlots) {
        console.warn("[Hotbar] Invalid slotToAnimate provided:", slotToAnimate);
        return;
    }

    // Clear existing timeouts and animation frames
    if (visualCooldownTimeoutRef.current) { clearTimeout(visualCooldownTimeoutRef.current); }
    if (animationFrameRef.current) { cancelAnimationFrame(animationFrameRef.current); }

    const itemForAnimation = findItemForSlot(slotToAnimate);
    if (!itemForAnimation) {
        console.log('[Hotbar] No item in animation slot', slotToAnimate, 'Aborting animation.');
        setIsVisualCooldownActive(false); // Ensure cooldown is not stuck if item disappears
        setCooldownSlot(null);
        return;
    }
    
    // Validate item type for the animation type
    if (isBandageEffect && itemForAnimation.definition.name !== "Bandage") {
        console.log('[Hotbar] Attempted to trigger bandage animation for non-bandage item in slot', slotToAnimate, 'Aborting. Item:', itemForAnimation.definition.name);
        return;
    }
    if (!isBandageEffect && itemForAnimation.definition.category.tag !== 'Consumable') {
        console.log('[Hotbar] Attempted to trigger consumable animation for non-consumable/non-bandage item in slot', slotToAnimate, 'Aborting. Item:', itemForAnimation.definition.name);
        return;
    }

    const timeoutDuration = isBandageEffect
                            ? BANDAGE_CLIENT_ANIMATION_DURATION_MS
                            : DEFAULT_CLIENT_ANIMATION_DURATION_MS;

    console.log('[Hotbar] Starting animation on slot:', slotToAnimate, 'Duration:', timeoutDuration, 'ms. Item:', itemForAnimation.definition.name);

    setIsVisualCooldownActive(true);
    setVisualCooldownStartTime(Date.now());
    setAnimationProgress(0);
    setCurrentAnimationDuration(timeoutDuration);
    setCooldownSlot(slotToAnimate);

    visualCooldownTimeoutRef.current = setTimeout(() => {
      console.log('[Hotbar] Animation timeout completed for slot:', slotToAnimate);
      // Only clear if this timeout is for the currently active cooldown slot
      if (cooldownSlot === slotToAnimate) {
        setIsVisualCooldownActive(false);
        setVisualCooldownStartTime(null);
        setAnimationProgress(0);
        setCurrentAnimationDuration(DEFAULT_CLIENT_ANIMATION_DURATION_MS);
        setCooldownSlot(null);
      }
    }, timeoutDuration);
  }, [numSlots, findItemForSlot, cooldownSlot]); // Added cooldownSlot to dependencies

  // Effect to watch for new bandage effects and trigger animation DURING usage
  useEffect(() => {
    if (!playerIdentity || !activeConsumableEffects) return;

    const playerHexId = playerIdentity.toHexString();
    const currentEffectIds = new Set<string>();

    // Collect current bandage effect IDs for this player
    activeConsumableEffects.forEach((effect, effectId) => {
      if (
        (effect.effectType.tag === "BandageBurst" || effect.effectType.tag === "RemoteBandageBurst") &&
        effect.playerId.toHexString() === playerHexId
      ) {
        currentEffectIds.add(effectId);
      }
    });

    // Check for new effects that weren't in the previous set
    const prevEffectIds = prevActiveEffectsRef.current;
    const newEffectIds = new Set([...currentEffectIds].filter(id => !prevEffectIds.has(id)));

      if (newEffectIds.size > 0) {
    // Find which hotbar slot contains a bandage to animate
    let bandageSlotFound = false;
    for (let slotIndex = 0; slotIndex < numSlots; slotIndex++) {
      const itemInSlot = findItemForSlot(slotIndex);
      if (itemInSlot && itemInSlot.definition.name === "Bandage") {
        // console.log('[Hotbar] New bandage effect detected! Starting 5-second animation on slot:', slotIndex);
        // Don't trigger the normal overlay for server effects, use a separate system
        setIsVisualCooldownActive(true);
        setVisualCooldownStartTime(Date.now());
        setAnimationProgress(0);
        setCurrentAnimationDuration(BANDAGE_CLIENT_ANIMATION_DURATION_MS);
        setCooldownSlot(slotIndex);
        bandageSlotFound = true;
        break; // Only animate the first bandage found
      }
    }
    if (!bandageSlotFound) {
      // console.log('[Hotbar] New bandage effect detected, but no bandage found in hotbar slots. No animation.');
    }
  }

    // Update the previous effects set
    prevActiveEffectsRef.current = currentEffectIds;
  }, [activeConsumableEffects, playerIdentity, triggerClientCooldownAnimation, findItemForSlot]);

  // Effect to stop animation when switching slots (except for consumable food items)
  useEffect(() => {
    // Stop any active animation when switching slots (but not on initial render)
    if (isVisualCooldownActive && prevSelectedSlotRef.current !== selectedSlot && cooldownSlot !== null) {
      // Check what item is in the cooldown slot to determine if we should stop the animation
      const itemInCooldownSlot = findItemForSlot(cooldownSlot);
      const shouldPersistAnimation = itemInCooldownSlot && 
        itemInCooldownSlot.definition.category.tag === 'Consumable' && 
        itemInCooldownSlot.definition.name !== 'Bandage'; // Food items persist, bandages don't
      
      if (shouldPersistAnimation) {
        // console.log('[Hotbar] Selected slot changed, but keeping consumable food animation active for slot:', cooldownSlot);
      } else {
        // console.log('[Hotbar] Selected slot changed from', prevSelectedSlotRef.current, 'to', selectedSlot, ', stopping visual cooldown animation');
        
        // Clear timeouts and animation frames
        if (visualCooldownTimeoutRef.current) {
          clearTimeout(visualCooldownTimeoutRef.current);
          visualCooldownTimeoutRef.current = null;
        }
        if (animationFrameRef.current) {
          cancelAnimationFrame(animationFrameRef.current);
          animationFrameRef.current = null;
        }
        
        // Reset animation state
        setIsVisualCooldownActive(false);
        setVisualCooldownStartTime(null);
        setAnimationProgress(0);
        setCurrentAnimationDuration(DEFAULT_CLIENT_ANIMATION_DURATION_MS);
        setCooldownSlot(null);
      }
    }
    
    // Update the previous slot ref
    prevSelectedSlotRef.current = selectedSlot;
  }, [selectedSlot, isVisualCooldownActive, cooldownSlot, findItemForSlot]); // Added cooldownSlot and findItemForSlot to dependencies

  const activateHotbarSlot = useCallback((slotIndex: number, isMouseWheelScroll: boolean = false, currentSelectedSlot?: number) => {
    const itemInSlot = findItemForSlot(slotIndex);
    if (!connection?.reducers) {
      if (!itemInSlot && playerIdentity) {
        cancelPlacement();
        try { connection?.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
      }
      return;
    }

    if (!itemInSlot) {
      if (playerIdentity) {
        cancelPlacement();
        try { connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer:", err); }
      }
      return;
    }

    const categoryTag = itemInSlot.definition.category.tag;
    const instanceId = BigInt(itemInSlot.instance.instanceId);
    const isEquippable = itemInSlot.definition.isEquippable;

    // console.log(`[Hotbar] Activating slot ${slotIndex}: "${itemInSlot.definition.name}" (Category: ${categoryTag}, Equippable: ${isEquippable})`);

    if (categoryTag === 'Consumable') {
      cancelPlacement(); // Always cancel placement if activating a consumable slot
      // Always clear any active item when selecting a consumable
      if (playerIdentity) {
        try { connection.reducers.clearActiveItemReducer(playerIdentity); } catch (err) { console.error("Error clearActiveItemReducer when selecting consumable:", err); }
      }

      // Use a more reliable way to check if this is the second click on the same consumable
      // Use the passed currentSelectedSlot parameter if available, otherwise fall back to state
      const actualCurrentSlot = currentSelectedSlot !== undefined ? currentSelectedSlot : selectedSlot;
      const isCurrentlySelected = actualCurrentSlot === slotIndex;
      
      // console.log(`[Hotbar] Consumable click debug: slotIndex=${slotIndex}, currentSelectedSlot=${currentSelectedSlot}, selectedSlot=${selectedSlot}, actualCurrentSlot=${actualCurrentSlot}, isCurrentlySelected=${isCurrentlySelected}, isMouseWheelScroll=${isMouseWheelScroll}`);
      
      if (isCurrentlySelected && !isMouseWheelScroll) {
        // Second click/press on already selected consumable - actually consume it
        // Check if animation is already running on this slot
        if (isVisualCooldownActive && cooldownSlot === slotIndex) {
          // console.log('[Hotbar] Animation already running on slot:', slotIndex, '- ignoring click');
          return; // Don't consume again or retrigger animation
        }
        
        try {
          // console.log('[Hotbar] Consuming item on second click:', itemInSlot.definition.name, 'Instance ID:', instanceId);
          connection.reducers.consumeItem(instanceId);
          // Trigger immediate animation - optimistic UI for responsiveness (1 second for consumables)
          // console.log('[Hotbar] Triggering consumable animation (1 second) on slot:', slotIndex);
          triggerClientCooldownAnimation(false, slotIndex); // Use default duration, specify the clicked slot
        } catch (err) { console.error(`Error consuming item ${instanceId}:`, err); }
      } else {
        // First click/press - just select the slot
        // console.log('[Hotbar] Selected consumable:', itemInSlot.definition.name, '- click again to consume');
      }
    } else if (categoryTag === 'Armor') {
      // console.log(`[Hotbar] Handling armor: ${itemInSlot.definition.name}`);
      cancelPlacement();
      try { 
        connection.reducers.equipArmorFromInventory(instanceId); 
        // console.log(`[Hotbar] Successfully equipped armor: ${itemInSlot.definition.name}`);
      } catch (err) { 
        console.error("Error equipArmorFromInventory:", err); 
      }
    } else if (categoryTag === 'Placeable') {
      // console.log(`[Hotbar] Handling placeable: ${itemInSlot.definition.name}`);
      const placementInfoData: PlacementItemInfo = {
        itemDefId: BigInt(itemInSlot.definition.id),
        itemName: itemInSlot.definition.name,
        iconAssetName: itemInSlot.definition.iconAssetName,
        instanceId: BigInt(itemInSlot.instance.instanceId)
      };
      startPlacement(placementInfoData);
      try { 
        if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); 
        // console.log(`[Hotbar] Cleared active item for placeable: ${itemInSlot.definition.name}`);
      } catch (err) { 
        console.error("Error clearActiveItemReducer when selecting placeable:", err); 
      }
    } else if (categoryTag === 'RangedWeapon') {
      // console.log(`[Hotbar] Handling ranged weapon: ${itemInSlot.definition.name}`);
      // console.log(`[Hotbar] Ranged weapon category tag: ${categoryTag}`);
      // console.log(`[Hotbar] Instance ID: ${instanceId}`);
      cancelPlacement();
      try { 
        connection.reducers.setActiveItemReducer(instanceId); 
        // console.log(`[Hotbar] Successfully set active ranged weapon: ${itemInSlot.definition.name}`);
        // console.log(`[Hotbar] Ranged weapon should now be equipped and ready to fire`);
        // TODO: Activate targeting reticle system here
      } catch (err) { 
        console.error("Error setActiveItemReducer for ranged weapon:", err); 
      }
    } else if (categoryTag === 'Tool' || categoryTag === 'Weapon' || isEquippable) {
      // console.log(`[Hotbar] Handling tool/weapon/equippable: ${itemInSlot.definition.name} (Category: ${categoryTag})`);
      cancelPlacement();
      try { 
        connection.reducers.setActiveItemReducer(instanceId); 
        // console.log(`[Hotbar] Successfully set active item: ${itemInSlot.definition.name}`);
      } catch (err) { 
        console.error("Error setActiveItemReducer:", err); 
      }
    } else {
      // console.log(`[Hotbar] Unhandled category or non-equippable item: ${itemInSlot.definition.name} (Category: ${categoryTag})`);
      // If item is not consumable, armor, placeable, or equippable,
      // it implies it's not directly "activatable" by selecting its hotbar slot.
      // Default behavior might be to clear any previously active item.
      cancelPlacement();
      try { 
        if (playerIdentity) connection.reducers.clearActiveItemReducer(playerIdentity); 
        // console.log(`[Hotbar] Cleared active item for unhandled category: ${itemInSlot.definition.name}`);
      } catch (err) { 
        console.error("Error clearActiveItemReducer:", err); 
      }
    }
  }, [findItemForSlot, connection, playerIdentity, cancelPlacement, startPlacement, triggerClientCooldownAnimation, isVisualCooldownActive, cooldownSlot]);

  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    const inventoryPanel = document.querySelector('.inventoryPanel');
    if (inventoryPanel) return;

    // Use event.code to reliably detect number keys regardless of Shift state
    let keyNum = -1;
    if (event.code.startsWith('Digit')) {
      keyNum = parseInt(event.code.substring(5)); // "Digit1" -> 1
    } else if (event.code.startsWith('Numpad')) {
      keyNum = parseInt(event.code.substring(6)); // "Numpad1" -> 1
    }

    if (keyNum !== -1 && keyNum >= 1 && keyNum <= numSlots) {
      const newSlotIndex = keyNum - 1;
      const currentSlot = selectedSlot; // Capture current value before state update
      // console.log(`[Hotbar] Keyboard ${keyNum} pressed: newSlotIndex=${newSlotIndex}, currentSlot=${currentSlot}, selectedSlot state=${selectedSlot}`);
      setSelectedSlot(newSlotIndex);
      // console.log(`[Hotbar] Called setSelectedSlot(${newSlotIndex})`);
      activateHotbarSlot(newSlotIndex, false, currentSlot);
    }
  }, [numSlots, activateHotbarSlot, selectedSlot]); // Updated dependencies

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  const handleSlotClick = (index: number) => {
      // console.log('[Hotbar] Slot clicked:', index);
      const currentSlot = selectedSlot; // Capture current value before state update
      setSelectedSlot(index);
      activateHotbarSlot(index, false, currentSlot); // Pass the current slot
  };

  const handleHotbarItemContextMenu = (event: React.MouseEvent<HTMLDivElement>, itemInfo: PopulatedItem) => {
      event.preventDefault();
      event.stopPropagation();
      if (itemInfo.instance.location.tag === 'Hotbar') {
        const hotbarData = itemInfo.instance.location.value as HotbarLocationData;
        // console.log(`[Hotbar ContextMenu] Right-clicked on: ${itemInfo.definition.name} in slot ${hotbarData.slotIndex}`);
      } else {
        // console.log(`[Hotbar ContextMenu] Right-clicked on: ${itemInfo.definition.name} (not in hotbar)`);
      }

      if (!connection?.reducers) return;
      const itemInstanceId = BigInt(itemInfo.instance.instanceId);

      if (interactingWith?.type === 'wooden_storage_box') {
          const boxIdNum = Number(interactingWith.id);
          try {
              connection.reducers.quickMoveToBox(boxIdNum, itemInstanceId);
          } catch (error: any) {
              console.error("[Hotbar ContextMenu Hotbar->Box] Failed to call quickMoveToBox reducer:", error);
          }
          return;
      } 
      else if (interactingWith?.type === 'campfire') {
          const campfireIdNum = Number(interactingWith.id);
           try {
               connection.reducers.quickMoveToCampfire(campfireIdNum, itemInstanceId);
           } catch (error: any) {
               console.error("[Hotbar ContextMenu Hotbar->Campfire] Failed to call quickMoveToCampfire reducer:", error);
           }
           return;
      } 
      else if (interactingWith?.type === 'player_corpse') {
           const corpseId = Number(interactingWith.id);
           try {
               connection.reducers.quickMoveToCorpse(corpseId, itemInstanceId);
           } catch (error: any) {
               console.error("[Hotbar ContextMenu Hotbar->Corpse] Failed to call quickMoveToCorpse reducer:", error);
           }
           return;
      } else if (interactingWith?.type === 'stash') {
          const stashId = Number(interactingWith.id);
          const currentStash = stashes.get(interactingWith.id.toString());
          if (currentStash && !currentStash.isHidden) {
            try {
                connection.reducers.quickMoveToStash(stashId, itemInstanceId);
            } catch (error: any) {
                console.error("[Hotbar ContextMenu Hotbar->Stash] Failed to call quickMoveToStash reducer:", error);
            }
          } else {
            // console.log(`[Hotbar ContextMenu Hotbar->Stash] Stash ${stashId} is hidden or not found. Cannot quick move.`);
          }
          return;
      }
      else {
          const isArmor = itemInfo.definition.category.tag === 'Armor';
          const hasEquipSlot = itemInfo.definition.equipmentSlotType !== null && itemInfo.definition.equipmentSlotType !== undefined;
          
          if (isArmor && hasEquipSlot) {
               try {
                   connection.reducers.equipArmorFromInventory(itemInstanceId);
               } catch (error: any) {
                   console.error("[Hotbar ContextMenu Equip] Failed to call equipArmorFromInventory reducer:", error);
              }
              return;
          }
          

          

      }
  };

  // console.log('[Hotbar] Render: animationProgress state:', animationProgress.toFixed(3)); // Added log

  // Added handleWheel and updated useEffect for listeners
  const handleWheel = useCallback((event: WheelEvent) => {
    const inventoryPanel = document.querySelector('[data-id="inventory-panel"]'); // Use the data-id selector
    
    // If inventory is open, or chat input is focused, or other UI elements that might use wheel scroll, do nothing.
    const chatInputIsFocused = document.activeElement?.matches('[data-is-chat-input="true"]');
    const craftSearchIsFocused = document.activeElement?.id === 'craftSearchInput'; // Example ID

    if (inventoryPanel || chatInputIsFocused || craftSearchIsFocused || event.deltaY === 0) {
      return; // Don't interfere if inventory/chat/search is open, or no vertical scroll
    }

    event.preventDefault(); // Prevent page scrolling (only if inventory is NOT open)

    setSelectedSlot(prevSlot => {
      let newSlot;
      if (event.deltaY < 0) { // Scroll up
        newSlot = (prevSlot - 1 + numSlots) % numSlots;
      } else { // Scroll down
        newSlot = (prevSlot + 1) % numSlots;
      }
      activateHotbarSlot(newSlot, true, prevSlot); // Pass true for isMouseWheelScroll and current slot
      return newSlot;
    });
  }, [numSlots, activateHotbarSlot]); // activateHotbarSlot is a dependency

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false }); // Add wheel listener, not passive
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [handleKeyDown, handleWheel]); // Add handleWheel to dependencies

  // Calculate overlay position for server-triggered effects
  const getSlotPosition = (slotIndex: number) => {
    const BORDER_WIDTH = 2; // Each slot has a 2px border
    const hotbarLeft = window.innerWidth / 2 - ((numSlots * (SLOT_SIZE + SLOT_MARGIN) - SLOT_MARGIN) / 2) - SLOT_MARGIN;
    const slotLeft = hotbarLeft + slotIndex * (SLOT_SIZE + SLOT_MARGIN) + SLOT_MARGIN;
    return {
      left: slotLeft + BORDER_WIDTH, // Offset by border width
      bottom: 15 + SLOT_MARGIN + BORDER_WIDTH, // Offset by border width
      width: SLOT_SIZE - (BORDER_WIDTH * 2), // Reduce by border on both sides
      height: SLOT_SIZE - (BORDER_WIDTH * 2), // Reduce by border on both sides
    };
  };

  return (
    <>
      <div style={{
        position: 'fixed',
        bottom: '15px',
        left: '50%',
        transform: 'translateX(-50%)',
        display: 'flex',
        backgroundColor: UI_BG_COLOR,
        padding: `${SLOT_MARGIN}px`,
        borderRadius: '4px',
        border: `1px solid ${UI_BORDER_COLOR}`,
        boxShadow: UI_SHADOW,
        fontFamily: UI_FONT_FAMILY,
        zIndex: 100,
      }}>
      {Array.from({ length: numSlots }).map((_, index) => {
        const populatedItem = findItemForSlot(index);
        const currentSlotInfo: DragSourceSlotInfo = { type: 'hotbar', index: index };

        return (
          <DroppableSlot
            key={`hotbar-${index}`}
            slotInfo={currentSlotInfo}
            onItemDrop={onItemDrop}
            className={undefined}
            onClick={() => handleSlotClick(index)}
            style={{
                position: 'relative',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                width: `${SLOT_SIZE}px`,
                height: `${SLOT_SIZE}px`,
                border: `2px solid ${index === selectedSlot ? SELECTED_BORDER_COLOR : UI_BORDER_COLOR}`,
                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                borderRadius: '3px',
                marginLeft: index > 0 ? `${SLOT_MARGIN}px` : '0px',
                transition: 'border-color 0.1s ease-in-out',
                boxSizing: 'border-box',
                cursor: 'pointer',
                overflow: 'hidden',
            }}
            isDraggingOver={false}
            overlayProgress={
              (isVisualCooldownActive && cooldownSlot === index) ? animationProgress :
              undefined
            }
            overlayColor={
              (isVisualCooldownActive && cooldownSlot === index) ? 'rgba(0, 0, 0, 0.4)' :
              'rgba(0, 0, 0, 0.4)'
            }
            overlayType={
              (isVisualCooldownActive && cooldownSlot === index) ? 'consumable' :
              'consumable'
            }
          >
            <span
                style={{ position: 'absolute', bottom: '2px', right: '4px', fontSize: '10px', color: 'rgba(255, 255, 255, 0.7)', userSelect: 'none', pointerEvents: 'none', zIndex: 3 }}
            >
              {index + 1}
            </span>

            {populatedItem && (
                <DraggableItem
                    key={`draggable-${index}-${isVisualCooldownActive}-${cooldownSlot}`}
                    item={populatedItem}
                    sourceSlot={currentSlotInfo}
                    onItemDragStart={onItemDragStart}
                    onItemDrop={onItemDrop}
                    onContextMenu={(event) => handleHotbarItemContextMenu(event, populatedItem)}
                 />
            )}
            {/* Debug info for consumable cooldowns */}
            {cooldownSlot === index && (
              <div style={{
                position: 'absolute',
                top: '-20px',
                left: '0px',
                fontSize: '8px',
                color: 'yellow',
                pointerEvents: 'none',
                zIndex: 10
              }}>
                {isVisualCooldownActive ? `${Math.round(animationProgress * 100)}%` : 'inactive'}
              </div>
            )}
            {/* Debug info for weapon cooldowns */}
            {weaponCooldownSlot === index && (
              <div style={{
                position: 'absolute',
                top: '-35px',
                left: '0px',
                fontSize: '8px',
                color: 'orange',
                pointerEvents: 'none',
                zIndex: 10
              }}>
                Weapon: {isWeaponCooldownActive ? `${Math.round(weaponCooldownProgress * 100)}%` : 'inactive'}
              </div>
            )}
          </DroppableSlot>
        );
      })}
      </div>
      
      {/* Separate overlay system for server-triggered effects that renders at body level */}
      {isVisualCooldownActive && cooldownSlot !== null && (() => {
        const slotPos = getSlotPosition(cooldownSlot);
        return (
          <div
            style={{
              position: 'fixed',
              left: `${slotPos.left}px`,
              bottom: `${slotPos.bottom}px`,
              width: `${slotPos.width}px`,
              height: `${slotPos.height}px`,
              zIndex: 10000, // Above everything
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '0px',
                left: '0px',
                width: '100%',
                height: `${(1 - animationProgress) * 100}%`,
                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                borderRadius: '2px',
              }}
              title={`Server Cooldown: ${Math.round((1 - animationProgress) * 100)}% remaining`}
            />
          </div>
        );
      })()}
      
      {/* Weapon cooldown overlay using the exact same system as consumables */}
      {isWeaponCooldownActive && weaponCooldownSlot !== null && (() => {
        const slotPos = getSlotPosition(weaponCooldownSlot);
        return (
          <div
            style={{
              position: 'fixed',
              left: `${slotPos.left}px`,
              bottom: `${slotPos.bottom}px`,
              width: `${slotPos.width}px`,
              height: `${slotPos.height}px`,
              zIndex: 9999, // Just below consumable cooldowns
              pointerEvents: 'none',
            }}
          >
            <div
              style={{
                position: 'absolute',
                top: '0px',
                left: '0px',
                width: '100%',
                height: `${(1 - weaponCooldownProgress) * 100}%`,
                backgroundColor: 'rgba(0, 0, 0, 0.6)',
                borderRadius: '2px',
              }}
              title={`Weapon Cooldown: ${Math.round((1 - weaponCooldownProgress) * 100)}% remaining`}
            />
          </div>
        );
      })()}
    </>
  );
};

export default React.memo(Hotbar);