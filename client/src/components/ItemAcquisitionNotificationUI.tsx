import React, { useEffect, useState } from 'react';
import { NotificationItem } from '../types/notifications';
import { itemIcons } from '../utils/itemIconUtils'; // Assuming you have this for item icons

interface ItemAcquisitionNotificationUIProps {
  notifications: NotificationItem[];
  hasActiveCrafting?: boolean;
}

const MAX_NOTIFICATIONS = 5;
const NOTIFICATION_TIMEOUT_MS = 3000; // Notifications stay for 3 seconds

const ItemAcquisitionNotificationUI: React.FC<ItemAcquisitionNotificationUIProps> = ({ 
  notifications,
  hasActiveCrafting = false
}) => {
  const [visibleNotifications, setVisibleNotifications] = useState<NotificationItem[]>([]);

  useEffect(() => {
    // Update visible notifications when the prop changes
    // Display latest MAX_NOTIFICATIONS
    setVisibleNotifications(notifications.slice(-MAX_NOTIFICATIONS));
  }, [notifications]);

  if (visibleNotifications.length === 0) {
    return null;
  }

  // Calculate dynamic positioning based on whether there's active crafting
  const getBottomPosition = (): string => {
    if (hasActiveCrafting) {
      // Position above the crafting queue (which is at 170px, plus some height for the crafting UI)
      return '230px';
    } else {
      // Normal position when no crafting is active
      return '160px';
    }
  };

  return (
    <div style={{
      position: 'fixed',
      bottom: getBottomPosition(),
      right: '15px',
      display: 'flex',
      flexDirection: 'column-reverse', // New items appear at the bottom and push others up
      alignItems: 'flex-end',
      zIndex: 100, // Ensure it's above other UI elements but below modals perhaps
    }}>
      {visibleNotifications.map((notif, index) => {
        const isMostRecent = index === visibleNotifications.length - 1;
        // Apply 'fading-out' class if isFadingOut is true
        const itemClassName = `notification-item ${notif.isFadingOut ? 'fading-out' : ''}`;
        return (
          <div
            key={notif.id}
            className={itemClassName} // Use dynamic class name
            style={{
              display: 'flex',
              alignItems: 'center',
              backgroundColor: isMostRecent ? 'rgba(40, 40, 55, 0.92)' : 'rgba(30, 30, 45, 0.9)', // Lighter for recent
              color: 'white',
              padding: '6px 10px',
              borderRadius: '4px',
              border: isMostRecent ? '1px solid #a0a0e0' : '1px solid #505070',
              marginBottom: '5px',
              boxShadow: isMostRecent ? '0 0 8px rgba(160, 160, 224, 0.7)' : '1px 1px 0px rgba(0,0,0,0.4)',
              fontFamily: '"Press Start 2P", cursive',
              fontSize: '11px',
              minWidth: '180px',
              transition: 'border 0.3s ease-out, box-shadow 0.3s ease-out', // Smooth transition for highlight
            }}
          >
            <img 
              src={itemIcons[notif.itemIcon] || itemIcons['unknown']} // Fallback to unknown icon
              alt={notif.itemName}
              style={{ width: '20px', height: '20px', marginRight: '8px', imageRendering: 'pixelated' }}
            />
            <span>
                {`${notif.quantityChange > 0 ? '+' : ''}${notif.quantityChange} ${notif.itemName}`}
                {notif.currentTotalInInventory !== undefined && (
                    <span style={{ color: 'rgba(200, 200, 200, 0.9)', marginLeft: '5px' }}>{`(${notif.currentTotalInInventory})`}</span>
                )}
            </span>
          </div>
        );
      })}
    </div>
  );
};

// Define keyframes and classes for animations
const styles = `
  @keyframes fadeInUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes fadeOutUp {
    from { opacity: 1; transform: translateY(0); }
    to { opacity: 0; transform: translateY(-10px); }
  }

  .notification-item {
    /* Default styles are applied via inline style prop */
    /* Animation for fade-in is applied by default */
    animation: fadeInUp 0.5s ease-out forwards;
  }

  .notification-item.fading-out {
    animation: fadeOutUp 0.5s ease-out forwards;
  }
`;

// Inject styles into the document head
// This is a common pattern for component-specific global styles if not using CSS-in-JS or modules
if (!document.getElementById('item-acquisition-notification-styles')) {
  const styleSheet = document.createElement("style");
  styleSheet.id = 'item-acquisition-notification-styles';
  styleSheet.type = "text/css";
  styleSheet.innerText = styles;
  document.head.appendChild(styleSheet);
}

export default React.memo(ItemAcquisitionNotificationUI); 