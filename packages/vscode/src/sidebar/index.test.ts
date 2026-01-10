import { describe, it, expect } from 'vitest';

describe('sidebar module exports', () => {
  it('should export WorkflowTreeProvider and related items', async () => {
    const sidebarModule = await import('./index');

    expect(sidebarModule.WorkflowTreeProvider).toBeDefined();
    expect(sidebarModule.SectionHeaderItem).toBeDefined();
    expect(sidebarModule.WorkflowItem).toBeDefined();
    expect(sidebarModule.TaskTreeItem).toBeDefined();
    expect(sidebarModule.QuestionTreeItem).toBeDefined();
  });

  it('should export CovenStatusBar', async () => {
    const { CovenStatusBar } = await import('./index');

    expect(CovenStatusBar).toBeDefined();
    expect(typeof CovenStatusBar).toBe('function');
  });
});
