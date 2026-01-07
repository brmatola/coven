import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import { ConflictFile, GitProvider, MergeResult } from './types';
import { GitCLI } from './GitCLI';
import { getLogger } from '../shared/logger';

/**
 * Resolution strategy for a conflict.
 */
export type ResolutionStrategy = 'ours' | 'theirs' | 'manual' | 'merged';

/**
 * Result of resolving a single conflict.
 */
export interface ConflictResolution {
  /** Path to the conflicting file */
  path: string;
  /** Strategy used to resolve */
  strategy: ResolutionStrategy;
  /** Resolved content */
  resolvedContent: string;
  /** Whether resolution succeeded */
  success: boolean;
  /** Error message if failed */
  error?: string;
}

/**
 * Events emitted by ConflictResolver.
 */
export interface ConflictResolverEvents {
  'conflict:detected': { taskId: string; conflicts: ConflictFile[] };
  'conflict:resolved': { taskId: string; resolution: ConflictResolution };
  'conflict:escalated': { taskId: string; conflict: ConflictFile };
  error: Error;
}

/**
 * Options for the resolver.
 */
export interface ConflictResolverOptions {
  /** Default strategy when no specific strategy is provided */
  defaultStrategy?: ResolutionStrategy;
  /** Whether to auto-resolve simple conflicts */
  autoResolve?: boolean;
}

/**
 * Handles merge conflicts during worktree merges.
 * Can attempt automatic resolution or escalate to user.
 */
export class ConflictResolver extends EventEmitter {
  private gitProvider: GitProvider;
  private workspaceRoot: string;
  private options: Required<ConflictResolverOptions>;
  private logger = getLogger();

  constructor(
    workspaceRoot: string,
    options: ConflictResolverOptions = {},
    gitProvider?: GitProvider
  ) {
    super();
    this.workspaceRoot = workspaceRoot;
    this.gitProvider = gitProvider ?? new GitCLI(workspaceRoot);
    this.options = {
      defaultStrategy: options.defaultStrategy ?? 'manual',
      autoResolve: options.autoResolve ?? false,
    };
  }

  /**
   * Detect conflicts in a merge result and emit events.
   */
  detectConflicts(taskId: string, result: MergeResult): ConflictFile[] {
    if (result.success || result.conflicts.length === 0) {
      return [];
    }

    this.emit('conflict:detected', { taskId, conflicts: result.conflicts });
    return result.conflicts;
  }

  /**
   * Resolve a single conflict using the specified strategy.
   */
  async resolveConflict(
    conflict: ConflictFile,
    strategy: ResolutionStrategy,
    workingDir: string,
    customContent?: string
  ): Promise<ConflictResolution> {
    const filePath = path.join(workingDir, conflict.path);

    let resolvedContent: string;
    switch (strategy) {
      case 'ours':
        resolvedContent = conflict.ourContent;
        break;
      case 'theirs':
        resolvedContent = conflict.theirContent;
        break;
      case 'merged':
        if (!customContent) {
          return {
            path: conflict.path,
            strategy,
            resolvedContent: '',
            success: false,
            error: 'Merged strategy requires custom content',
          };
        }
        resolvedContent = customContent;
        break;
      case 'manual':
      default:
        return {
          path: conflict.path,
          strategy: 'manual',
          resolvedContent: '',
          success: false,
          error: 'Manual resolution required',
        };
    }

    try {
      // Write resolved content
      await fs.promises.writeFile(filePath, resolvedContent);

      // Stage the resolved file
      await this.gitProvider.add(conflict.path, workingDir);

      return {
        path: conflict.path,
        strategy,
        resolvedContent,
        success: true,
      };
    } catch (err) {
      return {
        path: conflict.path,
        strategy,
        resolvedContent: '',
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * Attempt to resolve all conflicts in a merge.
   * Returns resolutions for each conflict.
   */
  async resolveAll(
    taskId: string,
    conflicts: ConflictFile[],
    workingDir: string,
    strategy?: ResolutionStrategy
  ): Promise<ConflictResolution[]> {
    const useStrategy = strategy ?? this.options.defaultStrategy;
    const resolutions: ConflictResolution[] = [];

    for (const conflict of conflicts) {
      const resolution = await this.resolveConflict(conflict, useStrategy, workingDir);
      resolutions.push(resolution);

      if (resolution.success) {
        this.emit('conflict:resolved', { taskId, resolution });
      } else {
        this.emit('conflict:escalated', { taskId, conflict });
      }
    }

    return resolutions;
  }

  /**
   * Check if a merge has unresolved conflicts.
   */
  async hasUnresolvedConflicts(workingDir: string): Promise<boolean> {
    // Check if there's an ongoing merge by looking for MERGE_HEAD
    try {
      const mergeHeadPath = path.join(workingDir, '.git', 'MERGE_HEAD');
      await fs.promises.access(mergeHeadPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Complete a merge after all conflicts are resolved.
   */
  async completeMerge(workingDir: string, message?: string): Promise<string> {
    // Stage any remaining changes
    await this.gitProvider.add('.', workingDir);

    // Complete the merge commit
    const commitMessage = message ?? 'Resolve merge conflicts';
    return this.gitProvider.commit(commitMessage, workingDir);
  }

  /**
   * Abort the current merge.
   */
  async abortMerge(workingDir: string): Promise<void> {
    await this.gitProvider.abortMerge(workingDir);
  }

  /**
   * Escalate a conflict to the user for manual resolution.
   */
  escalateToUser(taskId: string, conflict: ConflictFile): void {
    this.logger.info('Escalating conflict to user', { taskId, path: conflict.path });
    this.emit('conflict:escalated', { taskId, conflict });
  }

  /**
   * Dispose of resources.
   */
  dispose(): void {
    this.removeAllListeners();
  }
}
