export interface FishingState {
  isActive: boolean;
  isCasting: boolean;
  isMinigameActive: boolean;
  castTarget: { x: number; y: number } | null;
  fishingRod: string | null;
}

export interface FishingResult {
  success: boolean;
  loot: string[];
  message?: string;
}

export interface FishingSessionData {
  playerId: string;
  isActive: boolean;
  castTime: Date;
  targetX: number;
  targetY: number;
  fishingRod: string;
  hasBite: boolean;
}

export const FISHING_CONSTANTS = {
  RANGE: 600, // Doubled from 300
  BREAK_DISTANCE: 700, // Line breaks if player moves beyond this distance from cast point
  ENERGY_COST: 5,
  BITE_TIMER_DURATION: 10000, // 10 seconds
  VALID_FISHING_RODS: [
    'Primitive Reed Fishing Rod'
  ],
} as const; 