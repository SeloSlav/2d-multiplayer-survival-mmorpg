import type { DbConnection } from '../../../generated';
import {
  subscribeNonSpatialQueries,
  type NonSpatialSubscriptionSpec,
  type SubscriptionHandle,
} from './nonSpatialSubscriptions';

type TableEventHandlers = {
  onInsert?: (...args: any[]) => void;
  onUpdate?: (...args: any[]) => void;
  onDelete?: (...args: any[]) => void;
};

const GAMEPLAY_TABLE_REGISTRATIONS = [
  'player',
  'tree',
  'stone',
  'rune_stone',
  'cairn',
  'player_discovered_cairn',
  'campfire',
  'barbecue',
  'furnace',
  'lantern',
  'turret',
  'homestead_hearth',
  'broth_pot',
  'item_definition',
  'inventory_item',
  'world_state',
  'active_equipment',
  'harvestable_resource',
  'planted_seed',
  'dropped_item',
  'wooden_storage_box',
  'recipe',
  'crafting_queue_item',
  'player_stats',
  'achievement_definition',
  'player_achievement',
  'achievement_unlock_notification',
  'level_up_notification',
  'daily_login_notification',
  'progress_notification',
  'comparative_stat_notification',
  'leaderboard_entry',
  'daily_login_reward',
  'plant_config_definition',
  'player_discovered_plant',
  'drone_event',
  'sleeping_bag',
  'player_corpse',
  'stash',
  'active_consumable_effect',
  'cloud',
  'grass',
  'grass_state',
  'knocked_out_status',
  'ranged_weapon_stats',
  'projectile',
  'death_marker',
  'shelter',
  'minimap_cache',
  'player_dodge_roll_state',
  'fishing_session',
  'sound_event',
  'continuous_sound',
  'player_drinking_cooldown',
  'rain_collector',
  'water_patch',
  'fertilizer_patch',
  'fire_patch',
  'placed_explosive',
  'wild_animal',
  'animal_corpse',
  'caribou_breeding_data',
  'walrus_breeding_data',
  'caribou_rut_state',
  'walrus_rut_state',
  'barrel',
  'road_lamppost',
  'sea_stack',
  'foundation_cell',
  'wall_cell',
  'door',
  'fence',
  'fumarole',
  'basalt_column',
  'living_coral',
  'chunk_weather',
  'alk_station',
  'monument_part',
  'large_quarry',
  'alk_contract',
  'alk_player_contract',
  'alk_state',
  'player_shard_balance',
  'memory_grid_progress',
] as const;

type GameplayTableName = (typeof GAMEPLAY_TABLE_REGISTRATIONS)[number];

type GameplayNonSpatialSubscriptionDefinition = {
  query: string;
  errorLabel?: string;
  errorPrefix?: string;
  onError?: (error: unknown) => void;
};

const GAMEPLAY_NON_SPATIAL_SUBSCRIPTIONS: GameplayNonSpatialSubscriptionDefinition[] = [
  { query: 'SELECT * FROM player', errorLabel: 'PLAYER' },
  { query: 'SELECT * FROM rune_stone', errorLabel: 'RUNE_STONE' },
  { query: 'SELECT * FROM cairn', errorLabel: 'CAIRN' },
  { query: 'SELECT * FROM player_discovered_cairn', errorLabel: 'PLAYER_DISCOVERED_CAIRN' },
  { query: 'SELECT * FROM item_definition' },
  { query: 'SELECT * FROM recipe' },
  { query: 'SELECT * FROM world_state' },
  { query: 'SELECT * FROM minimap_cache', errorLabel: 'MINIMAP_CACHE' },
  { query: 'SELECT * FROM inventory_item', errorPrefix: '[useSpacetimeTables] Non-spatial INVENTORY subscription error:' },
  { query: 'SELECT * FROM active_equipment', errorPrefix: '[useSpacetimeTables] Non-spatial EQUIPMENT subscription error:' },
  { query: 'SELECT * FROM crafting_queue_item', errorPrefix: '[useSpacetimeTables] Non-spatial CRAFTING subscription error:' },
  { query: 'SELECT * FROM message', errorPrefix: '[useSpacetimeTables] Non-spatial MESSAGE subscription error:' },
  { query: 'SELECT * FROM player_pin', errorPrefix: '[useSpacetimeTables] Non-spatial PLAYER_PIN subscription error:' },
  { query: 'SELECT * FROM active_connection', errorPrefix: '[useSpacetimeTables] Non-spatial ACTIVE_CONNECTION subscription error:' },
  { query: 'SELECT * FROM sleeping_bag', errorPrefix: '[useSpacetimeTables] Non-spatial SLEEPING_BAG subscription error:' },
  { query: 'SELECT * FROM player_corpse', errorPrefix: '[useSpacetimeTables] Non-spatial PLAYER_CORPSE subscription error:' },
  { query: 'SELECT * FROM memory_grid_progress', errorPrefix: '[useSpacetimeTables] Non-spatial MEMORY_GRID_PROGRESS subscription error:' },
  { query: 'SELECT * FROM stash', errorPrefix: '[useSpacetimeTables] Non-spatial STASH subscription error:' },
  { query: 'SELECT * FROM active_consumable_effect', errorPrefix: "[useSpacetimeTables] Subscription for 'active_consumable_effect' ERROR:" },
  { query: 'SELECT * FROM knocked_out_status', errorPrefix: "[useSpacetimeTables] Subscription for 'knocked_out_status' ERROR:" },
  { query: 'SELECT * FROM ranged_weapon_stats', errorLabel: 'RANGED_WEAPON_STATS' },
  { query: 'SELECT * FROM projectile', errorLabel: 'PROJECTILE' },
  { query: 'SELECT * FROM projectile_resolved_event', errorLabel: 'PROJECTILE_RESOLVED_EVENT' },
  { query: 'SELECT * FROM death_marker', errorLabel: 'DEATH_MARKER' },
  { query: 'SELECT * FROM shelter', errorLabel: 'SHELTER' },
  { query: 'SELECT * FROM arrow_break_event', errorLabel: 'ARROW_BREAK_EVENT' },
  { query: 'SELECT * FROM thunder_event', errorLabel: 'THUNDER_EVENT' },
  {
    query: 'SELECT * FROM player_dodge_roll_state',
    onError: (error) => {
      console.error('[PLAYER_DODGE_ROLL_STATE Sub Error] Full error details:', error);
    },
  },
  { query: 'SELECT * FROM fishing_session', errorLabel: 'FISHING_SESSION' },
  { query: 'SELECT * FROM sound_event', errorLabel: 'SOUND_EVENT' },
  { query: 'SELECT * FROM continuous_sound', errorLabel: 'CONTINUOUS_SOUND' },
  { query: 'SELECT * FROM player_drinking_cooldown', errorLabel: 'PLAYER_DRINKING_COOLDOWN' },
  { query: 'SELECT * FROM animal_corpse', errorLabel: 'ANIMAL_CORPSE' },
  { query: 'SELECT * FROM chunk_weather', errorLabel: 'CHUNK_WEATHER' },
  { query: 'SELECT * FROM alk_station', errorLabel: 'ALK_STATION' },
  { query: 'SELECT * FROM alk_contract', errorLabel: 'ALK_CONTRACT' },
  { query: 'SELECT * FROM alk_player_contract', errorLabel: 'ALK_PLAYER_CONTRACT' },
  { query: 'SELECT * FROM alk_state', errorLabel: 'ALK_STATE' },
  { query: 'SELECT * FROM player_shard_balance', errorLabel: 'PLAYER_SHARD_BALANCE' },
  { query: 'SELECT * FROM monument_part', errorLabel: 'MONUMENT_PART' },
  { query: 'SELECT * FROM reed_marsh', errorLabel: 'REED_MARSH' },
  { query: 'SELECT * FROM tide_pool', errorLabel: 'TIDE_POOL' },
  { query: 'SELECT * FROM large_quarry', errorLabel: 'LARGE_QUARRY' },
  { query: 'SELECT * FROM matronage', errorLabel: 'MATRONAGE' },
  { query: 'SELECT * FROM matronage_member', errorLabel: 'MATRONAGE_MEMBER' },
  { query: 'SELECT * FROM matronage_invitation', errorLabel: 'MATRONAGE_INVITATION' },
  { query: 'SELECT * FROM matronage_owed_shards', errorLabel: 'MATRONAGE_OWED_SHARDS' },
  { query: 'SELECT * FROM caribou_breeding_data', errorLabel: 'CARIBOU_BREEDING_DATA' },
  { query: 'SELECT * FROM walrus_breeding_data', errorLabel: 'WALRUS_BREEDING_DATA' },
  { query: 'SELECT * FROM caribou_rut_state', errorLabel: 'CARIBOU_RUT_STATE' },
  { query: 'SELECT * FROM walrus_rut_state', errorLabel: 'WALRUS_RUT_STATE' },
  { query: 'SELECT * FROM player_stats', errorLabel: 'PLAYER_STATS' },
  { query: 'SELECT * FROM achievement_definition', errorLabel: 'ACHIEVEMENT_DEFINITION' },
  { query: 'SELECT * FROM player_achievement', errorLabel: 'PLAYER_ACHIEVEMENT' },
  { query: 'SELECT * FROM achievement_unlock_notification', errorLabel: 'ACHIEVEMENT_UNLOCK_NOTIFICATION' },
  { query: 'SELECT * FROM level_up_notification', errorLabel: 'LEVEL_UP_NOTIFICATION' },
  { query: 'SELECT * FROM daily_login_notification', errorLabel: 'DAILY_LOGIN_NOTIFICATION' },
  { query: 'SELECT * FROM progress_notification', errorLabel: 'PROGRESS_NOTIFICATION' },
  { query: 'SELECT * FROM comparative_stat_notification', errorLabel: 'COMPARATIVE_STAT_NOTIFICATION' },
  { query: 'SELECT * FROM leaderboard_entry', errorLabel: 'LEADERBOARD_ENTRY' },
  { query: 'SELECT * FROM daily_login_reward', errorLabel: 'DAILY_LOGIN_REWARD' },
  { query: 'SELECT * FROM plant_config_definition', errorLabel: 'PLANT_CONFIG_DEFINITION' },
  { query: 'SELECT * FROM player_discovered_plant', errorLabel: 'PLAYER_DISCOVERED_PLANT' },
  { query: 'SELECT * FROM tutorial_quest_definition', errorLabel: 'TUTORIAL_QUEST_DEFINITION' },
  { query: 'SELECT * FROM daily_quest_definition', errorLabel: 'DAILY_QUEST_DEFINITION' },
  { query: 'SELECT * FROM player_tutorial_progress', errorLabel: 'PLAYER_TUTORIAL_PROGRESS' },
  { query: 'SELECT * FROM player_daily_quest', errorLabel: 'PLAYER_DAILY_QUEST' },
  { query: 'SELECT * FROM quest_completion_notification', errorLabel: 'QUEST_COMPLETION_NOTIFICATION' },
  { query: 'SELECT * FROM quest_progress_notification', errorLabel: 'QUEST_PROGRESS_NOTIFICATION' },
  { query: 'SELECT * FROM sova_quest_message', errorLabel: 'SOVA_QUEST_MESSAGE' },
  { query: 'SELECT * FROM beacon_drop_event', errorLabel: 'BEACON_DROP_EVENT' },
  { query: 'SELECT * FROM drone_event', errorLabel: 'DRONE_EVENT' },
];

const UI_ONLY_NON_SPATIAL_QUERIES = new Set([
  'SELECT * FROM message',
  'SELECT * FROM player_pin',
  'SELECT * FROM active_connection',
  'SELECT * FROM matronage',
  'SELECT * FROM matronage_member',
  'SELECT * FROM matronage_invitation',
  'SELECT * FROM matronage_owed_shards',
  'SELECT * FROM tutorial_quest_definition',
  'SELECT * FROM daily_quest_definition',
  'SELECT * FROM player_tutorial_progress',
  'SELECT * FROM player_daily_quest',
  'SELECT * FROM quest_completion_notification',
  'SELECT * FROM quest_progress_notification',
  'SELECT * FROM sova_quest_message',
  'SELECT * FROM beacon_drop_event',
]);

export type GameplayTableBindings = Record<GameplayTableName, TableEventHandlers>;

interface SetupGameplayConnectionOptions {
  connection: DbConnection;
  tableBindings: GameplayTableBindings;
}

function registerTableCallbacks(table: any, handlers: TableEventHandlers): SubscriptionHandle[] {
  const cleanupHandles: SubscriptionHandle[] = [];

  if (handlers.onInsert) {
    table.onInsert(handlers.onInsert);
    cleanupHandles.push({
      unsubscribe: () => {
        table.removeOnInsert?.(handlers.onInsert);
      },
    });
  }
  if (handlers.onUpdate) {
    table.onUpdate(handlers.onUpdate);
    cleanupHandles.push({
      unsubscribe: () => {
        table.removeOnUpdate?.(handlers.onUpdate);
      },
    });
  }
  if (handlers.onDelete) {
    table.onDelete(handlers.onDelete);
    cleanupHandles.push({
      unsubscribe: () => {
        table.removeOnDelete?.(handlers.onDelete);
      },
    });
  }

  return cleanupHandles;
}

function toSubscriptionSpec(spec: GameplayNonSpatialSubscriptionDefinition): NonSpatialSubscriptionSpec {
  if (spec.onError) {
    return { query: spec.query, onError: spec.onError };
  }
  if (spec.errorPrefix) {
    return {
      query: spec.query,
      onError: (error) => console.error(spec.errorPrefix, error),
    };
  }
  if (spec.errorLabel) {
    return { query: spec.query, errorLabel: spec.errorLabel };
  }
  return { query: spec.query };
}

export function setupGameplayConnection({
  connection,
  tableBindings,
}: SetupGameplayConnectionOptions): SubscriptionHandle[] {
  const dbTables = connection.db as Record<string, any>;
  const cleanupHandles: SubscriptionHandle[] = [];

  for (const tableName of GAMEPLAY_TABLE_REGISTRATIONS) {
    const table = dbTables[tableName];
    if (!table) {
      console.error(`[GameplayConnectionSetup] Missing required gameplay table: ${tableName}`);
      continue;
    }
    cleanupHandles.push(...registerTableCallbacks(table, tableBindings[tableName]));
  }

  const gameplayNonSpatialSpecs = GAMEPLAY_NON_SPATIAL_SUBSCRIPTIONS
    .filter((spec) => !UI_ONLY_NON_SPATIAL_QUERIES.has(spec.query))
    .map(toSubscriptionSpec);

  return [
    ...cleanupHandles,
    ...subscribeNonSpatialQueries(connection, gameplayNonSpatialSpecs),
  ];
}
