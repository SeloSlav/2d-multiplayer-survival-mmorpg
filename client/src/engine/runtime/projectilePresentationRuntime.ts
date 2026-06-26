import type { DbConnection } from '../../generated';
import type { Projectile } from '../../generated/types';
import {
  cleanupProjectileTrackingForDeleted,
  getProjectileVisualDedupKey,
} from '../../utils/renderers/projectileRenderingUtils';

const RESOLVED_RETENTION_MS = 1500;

export interface ProjectilePresentationRuntimeOptions {
  connection: DbConnection | null;
  authoritativeProjectiles: Map<string, Projectile>;
  optimisticProjectiles: Map<string, Projectile>;
}

type ProjectileResolvedInsertHandler =
  Parameters<DbConnection['db']['projectile_resolved_event']['onInsert']>[0];

function getPresentationKey(projectile: Projectile, fallbackId: string): string {
  const clientShotId = projectile.clientShotId?.trim?.() ?? '';
  return clientShotId.length > 0 ? clientShotId : fallbackId;
}

export class ProjectilePresentationRuntime {
  private connection: DbConnection | null = null;
  private readonly resolvedProjectileIds = new Set<string>();
  private readonly resolvedClientShotIds = new Set<string>();
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private renderableProjectiles = new Map<string, Projectile>();
  private options: ProjectilePresentationRuntimeOptions | null = null;

  update(options?: ProjectilePresentationRuntimeOptions): Map<string, Projectile> {
    if (options) {
      this.options = options;
      this.configureConnection(options.connection);
    }

    if (!this.options) {
      this.renderableProjectiles = new Map();
      this.cleanupProjectileRenderTracking();
      return this.renderableProjectiles;
    }

    this.renderableProjectiles = this.computeRenderableProjectiles(this.options);
    this.cleanupProjectileRenderTracking();
    return this.renderableProjectiles;
  }

  getSnapshot(): Map<string, Projectile> {
    return this.renderableProjectiles;
  }

  stop(): void {
    this.disconnect();
    this.clearCleanupTimers();
    this.resolvedProjectileIds.clear();
    this.resolvedClientShotIds.clear();
    this.options = null;
    this.renderableProjectiles = new Map();
    this.cleanupProjectileRenderTracking();
  }

  private readonly handleProjectileResolvedInsert: ProjectileResolvedInsertHandler = (ctx, event) => {
    const eventContext = ctx?.event as { tag?: string; type?: string } | null | undefined;
    if (eventContext?.type === 'SubscribeApplied' || eventContext?.tag === 'SubscribeApplied') return;

    const projectileId = event.projectileId.toString();
    this.resolvedProjectileIds.add(projectileId);
    this.scheduleCleanup(`projectile:${projectileId}`, () => {
      this.resolvedProjectileIds.delete(projectileId);
    });

    const clientShotId = event.clientShotId?.trim?.() ?? '';
    if (clientShotId.length > 0) {
      this.resolvedClientShotIds.add(clientShotId);
      this.scheduleCleanup(`shot:${clientShotId}`, () => {
        this.resolvedClientShotIds.delete(clientShotId);
      });
    }
  };

  private configureConnection(connection: DbConnection | null): void {
    if (this.connection === connection) return;

    this.disconnect();
    this.clearCleanupTimers();
    this.connection = connection;
    this.connection?.db.projectile_resolved_event.onInsert(this.handleProjectileResolvedInsert);
  }

  private disconnect(): void {
    this.connection?.db.projectile_resolved_event.removeOnInsert(this.handleProjectileResolvedInsert);
    this.connection = null;
  }

  private scheduleCleanup(key: string, cleanup: () => void): void {
    const existingTimer = this.cleanupTimers.get(key);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(() => {
      cleanup();
      this.cleanupTimers.delete(key);
    }, RESOLVED_RETENTION_MS);
    this.cleanupTimers.set(key, timer);
  }

  private clearCleanupTimers(): void {
    this.cleanupTimers.forEach(timer => clearTimeout(timer));
    this.cleanupTimers.clear();
  }

  private computeRenderableProjectiles({
    authoritativeProjectiles,
    optimisticProjectiles,
  }: ProjectilePresentationRuntimeOptions): Map<string, Projectile> {
    const merged = new Map<string, Projectile>();
    const authoritativeClientShotIds = new Set<string>();

    authoritativeProjectiles.forEach((projectile, id) => {
      const clientShotId = projectile.clientShotId?.trim?.() ?? '';
      if (this.resolvedProjectileIds.has(id)) return;
      if (clientShotId && this.resolvedClientShotIds.has(clientShotId)) return;
      if (clientShotId) authoritativeClientShotIds.add(clientShotId);
      merged.set(getPresentationKey(projectile, id), projectile);
    });

    optimisticProjectiles.forEach((projectile, id) => {
      const clientShotId = projectile.clientShotId?.trim?.() ?? '';
      if (this.resolvedProjectileIds.has(id)) return;
      if (clientShotId && (
        this.resolvedClientShotIds.has(clientShotId)
        || authoritativeClientShotIds.has(clientShotId)
      )) {
        return;
      }

      const presentationKey = getPresentationKey(projectile, id);
      if (!merged.has(presentationKey)) {
        merged.set(presentationKey, projectile);
      }
    });

    const visuallyDeduped = new Map<string, Projectile>();
    const seenVisualKeys = new Set<string>();
    merged.forEach((projectile, key) => {
      const visualKey = getProjectileVisualDedupKey(projectile);
      if (seenVisualKeys.has(visualKey)) {
        return;
      }
      seenVisualKeys.add(visualKey);
      visuallyDeduped.set(key, projectile);
    });

    return visuallyDeduped;
  }

  private cleanupProjectileRenderTracking(): void {
    const ids = new Set<string>();
    this.renderableProjectiles.forEach(projectile => {
      ids.add(getProjectileVisualDedupKey(projectile));
    });
    cleanupProjectileTrackingForDeleted(ids);
  }
}
