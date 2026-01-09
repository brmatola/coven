import { describe, it, expect } from 'vitest';
import {
  generateTaskPrompt,
  generateSimpleTaskPrompt,
  generateConflictResolutionPrompt,
  generateAutoAcceptPrompt,
} from './prompts';
import { Task } from '../shared/types';

function createMockTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task-1',
    title: 'Implement feature X',
    description: 'Add a new feature that does X',
    status: 'working',
    priority: 'medium',
    dependencies: [],
    sourceId: 'test',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe('prompts', () => {
  describe('generateTaskPrompt', () => {
    it('should generate prompt with task title and description', () => {
      const task = createMockTask();
      const prompt = generateTaskPrompt({
        task,
        featureBranch: 'feature/main',
      });

      expect(prompt).toContain('# Task: Implement feature X');
      expect(prompt).toContain('Add a new feature that does X');
    });

    it('should include feature branch context', () => {
      const task = createMockTask();
      const prompt = generateTaskPrompt({
        task,
        featureBranch: 'feature/user-auth',
      });

      expect(prompt).toContain('feature/user-auth');
    });

    it('should include acceptance criteria from tags', () => {
      const task = createMockTask({
        tags: ['ac:Must handle edge cases', 'ac:Must have tests', 'other-tag'],
      });
      const prompt = generateTaskPrompt({
        task,
        featureBranch: 'feature/main',
      });

      expect(prompt).toContain('## Acceptance Criteria');
      expect(prompt).toContain('- Must handle edge cases');
      expect(prompt).toContain('- Must have tests');
      expect(prompt).not.toContain('other-tag');
    });

    it('should include codebase context when provided', () => {
      const task = createMockTask();
      const prompt = generateTaskPrompt({
        task,
        featureBranch: 'feature/main',
        codebase: {
          projectName: 'MyProject',
          directories: ['src', 'tests'],
          conventions: ['Use TypeScript', 'Follow ESLint rules'],
          testingInfo: 'Vitest for unit tests',
        },
      });

      expect(prompt).toContain('## Codebase Context');
      expect(prompt).toContain('Project: MyProject');
      expect(prompt).toContain('Key directories: src, tests');
      expect(prompt).toContain('- Use TypeScript');
      expect(prompt).toContain('Testing: Vitest for unit tests');
    });

    it('should include question policy when allowed', () => {
      const task = createMockTask();
      const prompt = generateTaskPrompt({
        task,
        featureBranch: 'feature/main',
        allowQuestions: true,
      });

      expect(prompt).toContain('## Questions');
      expect(prompt).toContain('ask questions');
    });

    it('should exclude question policy when not allowed', () => {
      const task = createMockTask();
      const prompt = generateTaskPrompt({
        task,
        featureBranch: 'feature/main',
        allowQuestions: false,
      });

      expect(prompt).not.toContain('## Questions');
    });

    it('should include completion instructions', () => {
      const task = createMockTask();
      const prompt = generateTaskPrompt({
        task,
        featureBranch: 'feature/main',
      });

      expect(prompt).toContain('## Completion');
      expect(prompt).toContain('summary of changes');
    });

    it('should handle missing description', () => {
      const task = createMockTask({ description: '' });
      const prompt = generateTaskPrompt({
        task,
        featureBranch: 'feature/main',
      });

      expect(prompt).toContain('No description provided');
    });
  });

  describe('generateSimpleTaskPrompt', () => {
    it('should generate minimal prompt', () => {
      const prompt = generateSimpleTaskPrompt(
        'Add function',
        'Create a function that adds two numbers',
        '/path/to/worktree'
      );

      expect(prompt).toContain('# Task: Add function');
      expect(prompt).toContain('Create a function that adds two numbers');
      expect(prompt).toContain('Working directory: /path/to/worktree');
      expect(prompt).toContain('Complete this task');
    });
  });

  describe('generateConflictResolutionPrompt', () => {
    it('should list conflicting files', () => {
      const prompt = generateConflictResolutionPrompt(
        ['src/file1.ts', 'src/file2.ts'],
        'coven/session/task-1',
        'feature/main'
      );

      expect(prompt).toContain('# Merge Conflict Resolution');
      expect(prompt).toContain('- src/file1.ts');
      expect(prompt).toContain('- src/file2.ts');
      expect(prompt).toContain('coven/session/task-1');
      expect(prompt).toContain('feature/main');
    });

    it('should include resolution instructions', () => {
      const prompt = generateConflictResolutionPrompt([], 'branch-a', 'branch-b');

      expect(prompt).toContain('Review each conflict');
      expect(prompt).toContain('Ensure tests pass');
    });
  });

  describe('generateAutoAcceptPrompt', () => {
    it('should generate prompt for non-interactive mode', () => {
      const prompt = generateAutoAcceptPrompt(
        'Simple Task',
        'Do something simple',
        '/path/to/work'
      );

      expect(prompt).toContain('# Task: Simple Task');
      expect(prompt).toContain('Auto-Accept Mode');
      expect(prompt).toContain('Do not ask questions');
      expect(prompt).toContain('without user interaction');
    });
  });
});
