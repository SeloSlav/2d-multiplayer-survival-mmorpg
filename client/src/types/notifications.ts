export interface NotificationItem {
  id: string; // Unique key for React list rendering
  itemDefId: bigint; // To look up item definition
  itemName: string;
  itemIcon: string; // Path or key for the icon
  quantityChange: number; // e.g., +15 or -5 (though we'll focus on positive for acquisition)
  timestamp: number; // For managing queue and auto-removal
} 