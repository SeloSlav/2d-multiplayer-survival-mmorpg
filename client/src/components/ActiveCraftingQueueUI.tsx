import React, { useEffect, useState } from 'react';
import { CraftingQueueItem, ItemDefinition } from '../generated';
import { Identity } from '@clockworklabs/spacetimedb-sdk';
import { getItemIcon } from '../utils/itemIconUtils';

interface ActiveCraftingQueueUIProps {
  craftingQueueItems: Map<string, CraftingQueueItem>;
  itemDefinitions: Map<string, ItemDefinition>;
  playerIdentity: Identity | null;
}

const ActiveCraftingQueueUI: React.FC<ActiveCraftingQueueUIProps> = ({
  craftingQueueItems,
  itemDefinitions,
  playerIdentity,
}) => {
  const [currentTime, setCurrentTime] = useState(Date.now());

  // Timer to update remaining time every second
  useEffect(() => {
    const timerId = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);
    return () => clearInterval(timerId);
  }, []);

  // Get the next item to complete in the player's queue
  const getActiveItem = (): CraftingQueueItem | null => {
    if (!playerIdentity) return null;

    const playerItems = Array.from(craftingQueueItems.values())
      .filter(item => item.playerIdentity.isEqual(playerIdentity))
      .sort((a, b) => Number(a.finishTime.microsSinceUnixEpoch - b.finishTime.microsSinceUnixEpoch));

    return playerItems.length > 0 ? playerItems[0] : null;
  };

  // Calculate remaining time in seconds
  const calculateRemainingTime = (finishTime: bigint): number => {
    const finishTimeMs = Number(finishTime / 1000n);
    return Math.max(0, Math.ceil((finishTimeMs - currentTime) / 1000));
  };

  const activeItem = getActiveItem();

  if (!activeItem) {
    return null; // Don't render anything if no active crafting
  }

  const outputDef = itemDefinitions.get(activeItem.outputItemDefId.toString());
  const remainingTime = calculateRemainingTime(activeItem.finishTime.microsSinceUnixEpoch);
  const itemName = outputDef?.name || 'Unknown Item';
  const itemIcon = outputDef?.iconAssetName || 'error.png';

  // Format time display
  const formatTime = (seconds: number): string => {
    if (seconds <= 0) return 'Ready!';
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: '170px', // Fixed position just above StatusBar
      right: '15px',
      display: 'flex',
      alignItems: 'center',
      backgroundColor: 'rgba(40, 40, 55, 0.92)',
      color: 'white',
      padding: '8px 12px',
      borderRadius: '4px',
      border: '1px solid #a0a0e0',
      boxShadow: '0 0 8px rgba(160, 160, 224, 0.7)',
      fontFamily: "'Courier New', 'Consolas', 'Monaco', monospace", /* Cyberpunk font */
      fontSize: '10px',
      minWidth: '200px',
      zIndex: 75, // Between notifications (100) and status bars (50)
    }}>
      {/* Crafting Icon */}
      <div style={{
        width: '24px',
        height: '24px',
        marginRight: '10px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'rgba(60, 60, 80, 0.8)',
        borderRadius: '2px',
        border: '1px solid #505070',
      }}>
        <img 
          src={getItemIcon(itemIcon)} 
          alt={itemName}
          style={{ 
            width: '20px', 
            height: '20px', 
            imageRendering: 'pixelated' 
          }}
        />
      </div>

      {/* Progress Info */}
      <div style={{ flex: 1 }}>
        <div style={{ 
          color: '#ffffff',
          fontSize: '10px',
          marginBottom: '4px'
        }}>
          {itemName}
        </div>
        <div style={{ 
          color: remainingTime <= 5 ? '#40ff40' : '#a0a0c0',
          fontSize: '9px'
        }}>
          {formatTime(remainingTime)}
        </div>
      </div>

      {/* Optional progress bar */}
      <div style={{
        width: '4px',
        height: '40px',
        backgroundColor: '#333',
        borderRadius: '2px',
        overflow: 'hidden',
        marginLeft: '8px',
      }}>
        <div style={{
          width: '100%',
          height: `${Math.max(0, Math.min(100, ((currentTime - Number(activeItem.startTime.microsSinceUnixEpoch / 1000n)) / 
            (Number(activeItem.finishTime.microsSinceUnixEpoch / 1000n) - Number(activeItem.startTime.microsSinceUnixEpoch / 1000n))) * 100))}%`,
          backgroundColor: remainingTime <= 5 ? '#40ff40' : '#ffa040',
          transition: 'height 0.3s ease-in-out, background-color 0.3s ease-in-out',
          position: 'relative',
          bottom: 0,
          marginTop: 'auto',
        }} />
      </div>
    </div>
  );
};

export default React.memo(ActiveCraftingQueueUI); 