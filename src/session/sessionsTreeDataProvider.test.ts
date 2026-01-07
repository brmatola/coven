import { describe, it, expect, vi } from 'vitest';
import { TreeItemCollapsibleState } from 'vscode';
import { SessionsTreeDataProvider, SessionItem } from './sessionsTreeDataProvider';

describe('SessionsTreeDataProvider', () => {
  describe('getChildren()', () => {
    it('returns array with placeholder item when no sessions', async () => {
      const provider = new SessionsTreeDataProvider();

      const children = await provider.getChildren();

      expect(children).toHaveLength(1);
      expect(children[0]?.label).toBe('No active session');
    });

    it('returns items with None collapsible state', async () => {
      const provider = new SessionsTreeDataProvider();

      const children = await provider.getChildren();

      expect(children[0]?.collapsibleState).toBe(TreeItemCollapsibleState.None);
    });
  });

  describe('getTreeItem()', () => {
    it('returns the element unchanged', () => {
      const provider = new SessionsTreeDataProvider();
      const item = new SessionItem('Test', TreeItemCollapsibleState.None);

      const result = provider.getTreeItem(item);

      expect(result).toBe(item);
    });
  });

  describe('refresh()', () => {
    it('fires onDidChangeTreeData event', () => {
      const provider = new SessionsTreeDataProvider();
      const listener = vi.fn();
      provider.onDidChangeTreeData(listener);

      provider.refresh();

      expect(listener).toHaveBeenCalled();
    });
  });

  describe('onDidChangeTreeData', () => {
    it('allows subscribing to tree data changes', () => {
      const provider = new SessionsTreeDataProvider();
      const listener = vi.fn();

      const disposable = provider.onDidChangeTreeData(listener);

      expect(typeof disposable.dispose).toBe('function');
    });

    it('notifies multiple subscribers', () => {
      const provider = new SessionsTreeDataProvider();
      const listener1 = vi.fn();
      const listener2 = vi.fn();

      provider.onDidChangeTreeData(listener1);
      provider.onDidChangeTreeData(listener2);
      provider.refresh();

      expect(listener1).toHaveBeenCalled();
      expect(listener2).toHaveBeenCalled();
    });
  });
});

describe('SessionItem', () => {
  it('creates tree item with label', () => {
    const item = new SessionItem('My Session', TreeItemCollapsibleState.None);

    expect(item.label).toBe('My Session');
  });

  it('creates tree item with collapsible state', () => {
    const item = new SessionItem('Expandable', TreeItemCollapsibleState.Collapsed);

    expect(item.collapsibleState).toBe(TreeItemCollapsibleState.Collapsed);
  });

  it('extends vscode.TreeItem', () => {
    const item = new SessionItem('Test', TreeItemCollapsibleState.None);

    // TreeItem properties should be accessible
    expect(item.label).toBeDefined();
    expect(item.collapsibleState).toBeDefined();
  });
});
