import { describe, it, expect } from 'vitest';

describe('sidebar module exports', () => {
  it('should export GrimoireTreeProvider and related items', async () => {
    const sidebarModule = await import('./index');

    expect(sidebarModule.GrimoireTreeProvider).toBeDefined();
    expect(sidebarModule.GrimoireTreeItem).toBeDefined();
    expect(sidebarModule.SessionHeaderItem).toBeDefined();
    expect(sidebarModule.TaskGroupItem).toBeDefined();
    expect(sidebarModule.TaskItem).toBeDefined();
    expect(sidebarModule.FamiliarItem).toBeDefined();
    expect(sidebarModule.EmptyStateItem).toBeDefined();
    expect(sidebarModule.NoSessionItem).toBeDefined();
  });

  it('should export CovenStatusBar', async () => {
    const { CovenStatusBar } = await import('./index');

    expect(CovenStatusBar).toBeDefined();
    expect(typeof CovenStatusBar).toBe('function');
  });
});
