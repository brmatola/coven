import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SetupTreeProvider, ComponentItem, ActionItem } from './SetupTreeProvider';
import { __resetWorkspaceFolders } from 'vscode';

// Mock detection module
vi.mock('./detection', () => ({
  detectWorkspaceComponents: vi.fn(),
}));

// Mock commands module
vi.mock('./commands', () => ({
  onDidInitializeComponent: {
    event: vi.fn(() => ({ dispose: vi.fn() })),
  },
}));

import { detectWorkspaceComponents } from './detection';
import type { WorkspaceDetectionState } from './detection';

function createMockDetectionState(overrides: Partial<WorkspaceDetectionState> = {}): WorkspaceDetectionState {
  return {
    git: {
      status: 'missing',
      details: 'No .git directory',
      hasGitDir: false,
      isValidRepo: false,
    },
    beads: {
      status: 'missing',
      details: 'Beads not configured',
      hasBeadsDir: false,
      hasCliAvailable: false,
    },
    coven: {
      status: 'missing',
      details: 'Coven not configured',
      hasCovenDir: false,
      hasConfigFile: false,
    },
    openspec: {
      status: 'missing',
      details: 'OpenSpec not configured',
      hasOpenspecDir: false,
      hasCliAvailable: false,
    },
    isFullyInitialized: false,
    isPartiallyInitialized: false,
    ...overrides,
  };
}

describe('SetupTreeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetWorkspaceFolders();

    // Default mock returns all components missing
    (detectWorkspaceComponents as ReturnType<typeof vi.fn>).mockResolvedValue(createMockDetectionState());
  });

  describe('getChildren() at root level', () => {
    it('returns four component items for all components', async () => {
      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();

      expect(children).toHaveLength(4);
      expect(children[0]).toBeInstanceOf(ComponentItem);
      expect(children[1]).toBeInstanceOf(ComponentItem);
      expect(children[2]).toBeInstanceOf(ComponentItem);
      expect(children[3]).toBeInstanceOf(ComponentItem);
    });

    it('shows git as first item', async () => {
      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();

      const gitItem = children[0] as ComponentItem;
      expect(gitItem.componentId).toBe('git');
      expect(gitItem.label).toBe('Git Repository');
    });

    it('shows correct order: git, beads, coven, openspec', async () => {
      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();

      const ids = children.map((c) => (c as ComponentItem).componentId);
      expect(ids).toEqual(['git', 'beads', 'coven', 'openspec']);
    });
  });

  describe('ComponentItem status icons', () => {
    it('shows check icon for complete status', async () => {
      (detectWorkspaceComponents as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockDetectionState({
          git: {
            status: 'complete',
            details: 'Git initialized',
            hasGitDir: true,
            isValidRepo: true,
            currentBranch: 'main',
          },
        })
      );

      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();
      const gitItem = children[0] as ComponentItem;

      expect(gitItem.iconPath).toBeDefined();
      expect((gitItem.iconPath as { id: string }).id).toBe('check');
    });

    it('shows warning icon for partial status', async () => {
      (detectWorkspaceComponents as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockDetectionState({
          beads: {
            status: 'partial',
            details: 'CLI available but not initialized',
            hasBeadsDir: false,
            hasCliAvailable: true,
            cliVersion: 'bd version 1.0.0',
          },
          git: {
            status: 'complete',
            details: 'Git initialized',
            hasGitDir: true,
            isValidRepo: true,
            currentBranch: 'main',
          },
        })
      );

      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();
      const beadsItem = children[1] as ComponentItem;

      expect((beadsItem.iconPath as { id: string }).id).toBe('warning');
    });

    it('shows circle-outline icon for missing status', async () => {
      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();
      const gitItem = children[0] as ComponentItem;

      expect((gitItem.iconPath as { id: string }).id).toBe('circle-outline');
    });
  });

  describe('ComponentItem descriptions', () => {
    it('shows branch name for complete git', async () => {
      (detectWorkspaceComponents as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockDetectionState({
          git: {
            status: 'complete',
            details: 'Git initialized',
            hasGitDir: true,
            isValidRepo: true,
            currentBranch: 'feature/test',
          },
        })
      );

      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();
      const gitItem = children[0] as ComponentItem;

      expect(gitItem.description).toBe('feature/test');
    });

    it('shows CLI version for complete beads', async () => {
      (detectWorkspaceComponents as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockDetectionState({
          git: {
            status: 'complete',
            details: 'Git initialized',
            hasGitDir: true,
            isValidRepo: true,
            currentBranch: 'main',
          },
          beads: {
            status: 'complete',
            details: 'Beads initialized',
            hasBeadsDir: true,
            hasCliAvailable: true,
            cliVersion: 'bd version 1.2.3',
          },
        })
      );

      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();
      const beadsItem = children[1] as ComponentItem;

      expect(beadsItem.description).toBe('bd version 1.2.3');
    });

    it('shows (optional) for openspec when not complete', async () => {
      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();
      const openspecItem = children[3] as ComponentItem;

      expect(openspecItem.description).toBe('(optional)');
    });
  });

  describe('Component dependencies', () => {
    it('marks beads as disabled when git is missing', async () => {
      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();
      const beadsItem = children[1] as ComponentItem;

      expect(beadsItem.isDisabled).toBe(true);
      expect(beadsItem.disabledReason).toBe('Git repository required first');
    });

    it('marks coven as disabled when git is missing', async () => {
      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();
      const covenItem = children[2] as ComponentItem;

      expect(covenItem.isDisabled).toBe(true);
    });

    it('marks openspec as disabled when git is missing', async () => {
      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();
      const openspecItem = children[3] as ComponentItem;

      expect(openspecItem.isDisabled).toBe(true);
    });

    it('enables beads when git is complete', async () => {
      (detectWorkspaceComponents as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockDetectionState({
          git: {
            status: 'complete',
            details: 'Git initialized',
            hasGitDir: true,
            isValidRepo: true,
            currentBranch: 'main',
          },
        })
      );

      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();
      const beadsItem = children[1] as ComponentItem;

      expect(beadsItem.isDisabled).toBe(false);
    });
  });

  describe('getChildren() for component with action', () => {
    it('returns ActionItem for missing component', async () => {
      const provider = new SetupTreeProvider();
      const rootChildren = await provider.getChildren();
      const gitItem = rootChildren[0] as ComponentItem;

      // Git is missing, so it should have an action child
      expect(gitItem.needsAction).toBe(true);

      const actionChildren = await provider.getChildren(gitItem);
      expect(actionChildren).toHaveLength(1);
      expect(actionChildren[0]).toBeInstanceOf(ActionItem);
    });

    it('returns empty array for complete component', async () => {
      (detectWorkspaceComponents as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockDetectionState({
          git: {
            status: 'complete',
            details: 'Git initialized',
            hasGitDir: true,
            isValidRepo: true,
            currentBranch: 'main',
          },
        })
      );

      const provider = new SetupTreeProvider();
      const rootChildren = await provider.getChildren();
      const gitItem = rootChildren[0] as ComponentItem;

      expect(gitItem.needsAction).toBe(false);

      const actionChildren = await provider.getChildren(gitItem);
      expect(actionChildren).toHaveLength(0);
    });
  });

  describe('ActionItem', () => {
    it('has command when not disabled', async () => {
      (detectWorkspaceComponents as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockDetectionState({
          git: { status: 'missing', details: 'Missing', hasGitDir: false, isValidRepo: false },
        })
      );

      const provider = new SetupTreeProvider();
      const rootChildren = await provider.getChildren();
      const gitItem = rootChildren[0] as ComponentItem;
      const actionChildren = await provider.getChildren(gitItem);
      const actionItem = actionChildren[0] as ActionItem;

      expect(actionItem.command).toBeDefined();
      expect(actionItem.command?.command).toBe('coven.initGit');
    });

    it('has no command when disabled', async () => {
      const provider = new SetupTreeProvider();
      const rootChildren = await provider.getChildren();
      const beadsItem = rootChildren[1] as ComponentItem;
      const actionChildren = await provider.getChildren(beadsItem);
      const actionItem = actionChildren[0] as ActionItem;

      expect(actionItem.command).toBeUndefined();
    });

    it('shows disabled tooltip when disabled', async () => {
      const provider = new SetupTreeProvider();
      const rootChildren = await provider.getChildren();
      const beadsItem = rootChildren[1] as ComponentItem;
      const actionChildren = await provider.getChildren(beadsItem);
      const actionItem = actionChildren[0] as ActionItem;

      expect(actionItem.tooltip).toBe('Git repository required first');
    });

    it('maps correct init commands', async () => {
      (detectWorkspaceComponents as ReturnType<typeof vi.fn>).mockResolvedValue(
        createMockDetectionState({
          git: {
            status: 'complete',
            details: 'Git initialized',
            hasGitDir: true,
            isValidRepo: true,
            currentBranch: 'main',
          },
          beads: { status: 'missing', details: 'Missing', hasBeadsDir: false, hasCliAvailable: true },
          coven: { status: 'missing', details: 'Missing', hasCovenDir: false, hasConfigFile: false },
          openspec: { status: 'missing', details: 'Missing', hasOpenspecDir: false, hasCliAvailable: true },
        })
      );

      const provider = new SetupTreeProvider();
      const rootChildren = await provider.getChildren();

      // Get action items for each component
      const beadsAction = (await provider.getChildren(rootChildren[1] as ComponentItem))[0] as ActionItem;
      const covenAction = (await provider.getChildren(rootChildren[2] as ComponentItem))[0] as ActionItem;
      const openspecAction = (await provider.getChildren(rootChildren[3] as ComponentItem))[0] as ActionItem;

      expect(beadsAction.command?.command).toBe('coven.initBeads');
      expect(covenAction.command?.command).toBe('coven.initCoven');
      expect(openspecAction.command?.command).toBe('coven.initOpenspec');
    });
  });

  describe('refresh()', () => {
    it('fetches new detection state and fires change event', async () => {
      const provider = new SetupTreeProvider();
      const changeListener = vi.fn();
      provider.onDidChangeTreeData(changeListener);

      await provider.refresh();

      expect(detectWorkspaceComponents).toHaveBeenCalled();
      expect(changeListener).toHaveBeenCalled();
    });
  });

  describe('dispose()', () => {
    it('cleans up resources', () => {
      const provider = new SetupTreeProvider();

      // Should not throw
      expect(() => provider.dispose()).not.toThrow();
    });
  });

  describe('contextValue', () => {
    it('includes component id and status', async () => {
      const provider = new SetupTreeProvider();
      const children = await provider.getChildren();
      const gitItem = children[0] as ComponentItem;

      expect(gitItem.contextValue).toBe('setup.component.git.missing');
    });

    it('includes action and component id', async () => {
      const provider = new SetupTreeProvider();
      const rootChildren = await provider.getChildren();
      const gitItem = rootChildren[0] as ComponentItem;
      const actionChildren = await provider.getChildren(gitItem);
      const actionItem = actionChildren[0] as ActionItem;

      expect(actionItem.contextValue).toBe('setup.action.git');
    });

    it('includes disabled state in action contextValue', async () => {
      const provider = new SetupTreeProvider();
      const rootChildren = await provider.getChildren();
      const beadsItem = rootChildren[1] as ComponentItem;
      const actionChildren = await provider.getChildren(beadsItem);
      const actionItem = actionChildren[0] as ActionItem;

      expect(actionItem.contextValue).toBe('setup.action.beads.disabled');
    });
  });
});
