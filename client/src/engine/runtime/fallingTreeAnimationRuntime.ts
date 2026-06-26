import type { Tree } from '../../generated/types';

export const TREE_FALL_DURATION_MS = 2500;

const POST_FALL_DISAPPEAR_DELAY_MS = 1500;
const CANVAS_VISIBILITY_DURATION_MS = TREE_FALL_DURATION_MS + POST_FALL_DISAPPEAR_DELAY_MS;
const CLEANUP_DELAY_MS = 100;

export interface FallingTreeState {
  treeId: string;
  startTime: number;
  posX: number;
  posY: number;
  treeType: unknown;
  imageSource: string;
  targetWidth: number;
}

export interface FallingTreeAnimationRuntimeSnapshot {
  fallingTrees: Map<string, FallingTreeState>;
  isTreeFalling: (treeId: string) => boolean;
  getFallProgress: (treeId: string) => number;
  updateFallingTreeCache: (treeId: string, imageSource: string, targetWidth: number) => void;
  TREE_FALL_DURATION_MS: number;
}

interface PreviousTreeState {
  health: number;
  respawnAt: number | undefined;
}

export class FallingTreeAnimationRuntime {
  private readonly fallingTrees = new Map<string, FallingTreeState>();
  private readonly previousTreeStates = new Map<string, PreviousTreeState>();

  private readonly snapshot: FallingTreeAnimationRuntimeSnapshot = {
    fallingTrees: this.fallingTrees,
    isTreeFalling: (treeId) => this.isTreeFalling(treeId),
    getFallProgress: (treeId) => this.getFallProgress(treeId),
    updateFallingTreeCache: (...args) => this.updateFallingTreeCache(...args),
    TREE_FALL_DURATION_MS,
  };

  update(trees: Map<string, Tree>): FallingTreeAnimationRuntimeSnapshot {
    const now = Date.now();

    trees.forEach((tree) => {
      const treeId = tree.id.toString();
      const previousState = this.previousTreeStates.get(treeId);

      if (this.fallingTrees.has(treeId) && tree.health > 0) {
        console.log(`[FallingTree] Tree ${treeId} respawned, removing animation`);
        this.fallingTrees.delete(treeId);
      }

      if (!this.fallingTrees.has(treeId)) {
        const isNewlyDestroyed = tree.health === 0
          && tree.respawnAt
          && tree.respawnAt.microsSinceUnixEpoch !== 0n
          && previousState !== undefined
          && previousState.health > 0;

        if (isNewlyDestroyed) {
          console.log(`[FallingTree] Tree ${treeId} destroyed, starting fall animation`);
          this.fallingTrees.set(treeId, {
            treeId,
            startTime: now,
            posX: tree.posX,
            posY: tree.posY,
            treeType: tree.treeType,
            imageSource: '',
            targetWidth: 0,
          });
        }
      }

      this.previousTreeStates.set(treeId, {
        health: tree.health,
        respawnAt: tree.respawnAt ? Number(tree.respawnAt.microsSinceUnixEpoch / 1000n) : undefined,
      });
    });

    this.fallingTrees.forEach((fallingTree, treeId) => {
      if (!trees.has(treeId)) {
        console.log(`[FallingTree] Tree ${treeId} no longer in view, removing animation`);
        this.fallingTrees.delete(treeId);
        this.previousTreeStates.delete(treeId);
        return;
      }

      if (fallingTree.startTime < now - CANVAS_VISIBILITY_DURATION_MS - CLEANUP_DELAY_MS) {
        console.log(`[FallingTree] Cleaning up completed animation for tree ${treeId}`);
        this.fallingTrees.delete(treeId);
        this.previousTreeStates.delete(treeId);
      }
    });

    return this.snapshot;
  }

  stop(): void {
    this.fallingTrees.clear();
    this.previousTreeStates.clear();
  }

  private isTreeFalling = (treeId: string): boolean => {
    const fallingTree = this.fallingTrees.get(treeId);
    if (!fallingTree) return false;

    return Date.now() - fallingTree.startTime < CANVAS_VISIBILITY_DURATION_MS;
  };

  private getFallProgress = (treeId: string): number => {
    const fallingTree = this.fallingTrees.get(treeId);
    if (!fallingTree) return 0;

    const elapsed = Date.now() - fallingTree.startTime;
    const progress = Math.min(elapsed / TREE_FALL_DURATION_MS, 1.0);

    return progress < 0.5
      ? 2 * progress * progress
      : 1 - Math.pow(-2 * progress + 2, 2) / 2;
  };

  private updateFallingTreeCache = (treeId: string, imageSource: string, targetWidth: number): void => {
    const tree = this.fallingTrees.get(treeId);
    if (!tree) return;

    this.fallingTrees.set(treeId, {
      ...tree,
      imageSource,
      targetWidth,
    });
  };
}
