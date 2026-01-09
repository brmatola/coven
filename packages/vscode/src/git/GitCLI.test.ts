import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';

// Create mock function that will be used by promisify
const mockExecAsync = vi.fn();

// Mock util.promisify to return our mock function
vi.mock('util', () => {
  return {
    promisify: vi.fn(() => mockExecAsync),
  };
});

// Mock fs for conflict parsing tests
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof fs>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: vi.fn(),
      mkdir: vi.fn().mockResolvedValue(undefined),
    },
  };
});

// Now import GitCLI - the mock is already set up
const { GitCLI, GitCLIError } = await import('./GitCLI');

describe('GitCLI', () => {
  let gitCLI: InstanceType<typeof GitCLI>;
  const repoRoot = '/test/repo';

  beforeEach(() => {
    vi.clearAllMocks();
    gitCLI = new GitCLI(repoRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('listWorktrees', () => {
    it('should parse porcelain output correctly', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: `worktree /test/repo
HEAD abc123def456789
branch refs/heads/main

worktree /test/repo/.coven/worktrees/task-1
HEAD def456abc789012
branch refs/heads/coven/session/task-1
`,
        stderr: '',
      });

      const worktrees = await gitCLI.listWorktrees();

      expect(worktrees).toHaveLength(2);
      expect(worktrees[0]).toEqual({
        path: '/test/repo',
        head: 'abc123def456789',
        branch: 'main',
        isMain: true,
        isBare: false,
      });
      expect(worktrees[1]).toEqual({
        path: '/test/repo/.coven/worktrees/task-1',
        head: 'def456abc789012',
        branch: 'coven/session/task-1',
        isMain: false,
        isBare: false,
      });
    });

    it('should handle detached HEAD', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: `worktree /test/repo
HEAD abc123
detached
`,
        stderr: '',
      });

      const worktrees = await gitCLI.listWorktrees();

      expect(worktrees[0]?.branch).toBe('HEAD (detached)');
    });

    it('should handle bare worktree', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: `worktree /test/repo
bare
`,
        stderr: '',
      });

      const worktrees = await gitCLI.listWorktrees();

      expect(worktrees[0]?.isBare).toBe(true);
    });

    it('should handle empty output', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const worktrees = await gitCLI.listWorktrees();

      expect(worktrees).toHaveLength(0);
    });
  });

  describe('createWorktree', () => {
    it('should build correct command for new branch', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' }) // worktree add
        .mockResolvedValueOnce({
          stdout: `worktree /test/worktree
HEAD abc123
branch refs/heads/new-branch
`,
          stderr: '',
        }); // worktree list

      await gitCLI.createWorktree('new-branch', '/test/worktree', {
        baseBranch: 'main',
        createBranch: true,
      });

      expect(mockExecAsync).toHaveBeenCalledWith(
        'git worktree add "/test/worktree" -b "new-branch" "main"',
        expect.objectContaining({ cwd: repoRoot })
      );
    });

    it('should build correct command for existing branch', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({
          stdout: `worktree /test/worktree
HEAD abc123
branch refs/heads/existing-branch
`,
          stderr: '',
        });

      await gitCLI.createWorktree('existing-branch', '/test/worktree', {
        createBranch: false,
      });

      expect(mockExecAsync).toHaveBeenCalledWith(
        'git worktree add "/test/worktree" "existing-branch"',
        expect.objectContaining({ cwd: repoRoot })
      );
    });

    it('should throw if worktree not found after creation', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await expect(
        gitCLI.createWorktree('branch', '/nonexistent', { createBranch: true })
      ).rejects.toThrow('Worktree created but not found');
    });
  });

  describe('deleteWorktree', () => {
    it('should use --force when force=true', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await gitCLI.deleteWorktree('/test/worktree', true);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'git worktree remove --force "/test/worktree"',
        expect.objectContaining({ cwd: repoRoot })
      );
    });

    it('should not use --force when force=false', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await gitCLI.deleteWorktree('/test/worktree', false);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'git worktree remove "/test/worktree"',
        expect.objectContaining({ cwd: repoRoot })
      );
    });
  });

  describe('getStatus', () => {
    it('should parse porcelain v2 output correctly', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: `# branch.head main
# branch.ab +2 -1
1 M. N... 100644 100644 100644 abc123 def456 src/modified.ts
1 .M N... 100644 100644 100644 abc123 def456 src/unstaged.ts
1 .D N... 100644 100644 000000 abc123 000000 src/deleted.ts
? src/untracked.ts
`,
        stderr: '',
      });

      const status = await gitCLI.getStatus();

      expect(status.branch).toBe('main');
      expect(status.ahead).toBe(2);
      expect(status.behind).toBe(1);
      expect(status.staged).toContain('src/modified.ts');
      expect(status.modified).toContain('src/unstaged.ts');
      expect(status.deleted).toContain('src/deleted.ts');
      expect(status.untracked).toContain('src/untracked.ts');
    });

    it('should handle clean repo', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: `# branch.head main
# branch.ab +0 -0
`,
        stderr: '',
      });

      const status = await gitCLI.getStatus();

      expect(status.staged).toHaveLength(0);
      expect(status.modified).toHaveLength(0);
      expect(status.untracked).toHaveLength(0);
      expect(status.deleted).toHaveLength(0);
    });

    it('should use provided working directory', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '# branch.head main\n', stderr: '' });

      await gitCLI.getStatus('/custom/path');

      expect(mockExecAsync).toHaveBeenCalledWith(
        'git status --porcelain=v2 --branch',
        expect.objectContaining({ cwd: '/custom/path' })
      );
    });
  });

  describe('merge', () => {
    it('should return success result on clean merge', async () => {
      mockExecAsync
        .mockResolvedValueOnce({
          stdout: 'Merge made by the "ort" strategy.\nabc123def456',
          stderr: '',
        })
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // getMergedFiles

      const result = await gitCLI.merge('feature-branch', { message: 'Merge feature' });

      expect(result.success).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it('should build correct merge command with options', async () => {
      mockExecAsync
        .mockResolvedValueOnce({ stdout: '', stderr: '' })
        .mockResolvedValueOnce({ stdout: '', stderr: '' });

      await gitCLI.merge('feature', {
        message: 'Merge feature',
        squash: true,
        fastForward: false,
      });

      expect(mockExecAsync).toHaveBeenCalledWith(
        expect.stringContaining('--squash'),
        expect.any(Object)
      );
    });

    it('should detect merge conflicts', async () => {
      const conflictError = new Error('CONFLICT (content): Merge conflict');
      mockExecAsync
        .mockRejectedValueOnce(conflictError)
        .mockResolvedValueOnce({ stdout: 'src/conflict.ts\n', stderr: '' }) // conflict files
        .mockResolvedValueOnce({ stdout: '', stderr: '' }); // merged files

      vi.mocked(fs.promises.readFile).mockResolvedValue(`<<<<<<< HEAD
our content
=======
their content
>>>>>>> feature
`);

      const result = await gitCLI.merge('feature-branch');

      expect(result.success).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]?.path).toBe('src/conflict.ts');
    });
  });

  describe('getCurrentBranch', () => {
    it('should return trimmed branch name', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '  main  \n', stderr: '' });

      const branch = await gitCLI.getCurrentBranch();

      expect(branch).toBe('main');
    });

    it('should use provided working directory', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'feature\n', stderr: '' });

      await gitCLI.getCurrentBranch('/custom/path');

      expect(mockExecAsync).toHaveBeenCalledWith(
        'git rev-parse --abbrev-ref HEAD',
        expect.objectContaining({ cwd: '/custom/path' })
      );
    });
  });

  describe('branchExists', () => {
    it('should return true when branch exists', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      const exists = await gitCLI.branchExists('main');

      expect(exists).toBe(true);
    });

    it('should return false when branch does not exist', async () => {
      mockExecAsync.mockRejectedValue(new Error('not a valid ref'));

      const exists = await gitCLI.branchExists('nonexistent');

      expect(exists).toBe(false);
    });
  });

  describe('createBranch', () => {
    it('should create branch from base', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await gitCLI.createBranch('feature', 'main');

      expect(mockExecAsync).toHaveBeenCalledWith(
        'git branch "feature" "main"',
        expect.any(Object)
      );
    });

    it('should create branch from HEAD when no base specified', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await gitCLI.createBranch('feature');

      expect(mockExecAsync).toHaveBeenCalledWith('git branch "feature"', expect.any(Object));
    });
  });

  describe('deleteBranch', () => {
    it('should use -D flag when force=true', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await gitCLI.deleteBranch('feature', true);

      expect(mockExecAsync).toHaveBeenCalledWith('git branch -D "feature"', expect.any(Object));
    });

    it('should use -d flag when force=false', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await gitCLI.deleteBranch('feature', false);

      expect(mockExecAsync).toHaveBeenCalledWith('git branch -d "feature"', expect.any(Object));
    });
  });

  describe('commit', () => {
    it('should escape quotes in message', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '[main abc123] message', stderr: '' });

      await gitCLI.commit('Message with "quotes"');

      expect(mockExecAsync).toHaveBeenCalledWith(
        'git commit -m "Message with \\"quotes\\""',
        expect.any(Object)
      );
    });

    it('should return commit hash', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '[main abc123f] commit message', stderr: '' });

      const hash = await gitCLI.commit('test');

      expect(hash).toBe('abc123f');
    });

    it('should return empty string if no hash in output', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'nothing to commit', stderr: '' });

      const hash = await gitCLI.commit('test');

      expect(hash).toBe('');
    });
  });

  describe('add', () => {
    it('should stage single file', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await gitCLI.add('src/file.ts');

      expect(mockExecAsync).toHaveBeenCalledWith('git add "src/file.ts"', expect.any(Object));
    });

    it('should stage multiple files', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await gitCLI.add(['src/file1.ts', 'src/file2.ts']);

      expect(mockExecAsync).toHaveBeenCalledWith(
        'git add "src/file1.ts" "src/file2.ts"',
        expect.any(Object)
      );
    });
  });

  describe('abortMerge', () => {
    it('should call git merge --abort', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '', stderr: '' });

      await gitCLI.abortMerge();

      expect(mockExecAsync).toHaveBeenCalledWith('git merge --abort', expect.any(Object));
    });
  });

  describe('isWorktree', () => {
    it('should return true when path is a worktree', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: `worktree /test/repo
HEAD abc123
branch refs/heads/main

worktree /test/worktree
HEAD def456
branch refs/heads/feature
`,
        stderr: '',
      });

      const isWt = await gitCLI.isWorktree('/test/worktree');

      expect(isWt).toBe(true);
    });

    it('should return false when path is not a worktree', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: `worktree /test/repo
HEAD abc123
branch refs/heads/main
`,
        stderr: '',
      });

      const isWt = await gitCLI.isWorktree('/nonexistent');

      expect(isWt).toBe(false);
    });
  });

  describe('getRepoRoot', () => {
    it('should return trimmed repo root', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '/home/user/project\n', stderr: '' });

      const root = await gitCLI.getRepoRoot();

      expect(root).toBe('/home/user/project');
    });
  });

  describe('getDiff', () => {
    it('should parse diff summary', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: `3\t0\tsrc/new-file.ts
5\t2\tsrc/modified.ts
0\t10\tsrc/deleted.ts
`,
        stderr: '',
      });

      const diff = await gitCLI.getDiff('main', 'feature');

      expect(diff.linesAdded).toBe(8);
      expect(diff.linesDeleted).toBe(12);
      expect(diff.added).toContain('src/new-file.ts');
      expect(diff.modified).toContain('src/modified.ts');
      expect(diff.deleted).toContain('src/deleted.ts');
    });

    it('should handle binary files', async () => {
      mockExecAsync.mockResolvedValue({
        stdout: `-\t-\timage.png
`,
        stderr: '',
      });

      const diff = await gitCLI.getDiff('main', 'feature');

      // Binary files show as - for add/del counts
      expect(diff.linesAdded).toBe(0);
      expect(diff.linesDeleted).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should throw GitCLIError on command failure', async () => {
      mockExecAsync.mockRejectedValue(new Error('git error'));

      await expect(gitCLI.getCurrentBranch()).rejects.toThrow(GitCLIError);
    });

    it('should include cause in GitCLIError', async () => {
      mockExecAsync.mockRejectedValue(new Error('original error'));

      try {
        await gitCLI.getCurrentBranch();
        expect.fail('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(GitCLIError);
        expect((err as GitCLIError).cause).toBeDefined();
      }
    });
  });

  describe('isAvailable', () => {
    it('should return true when git is available', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'git version 2.40.0', stderr: '' });

      const available = await gitCLI.isAvailable();

      expect(available).toBe(true);
    });

    it('should return false when git is not available', async () => {
      mockExecAsync.mockRejectedValue(new Error('command not found'));

      const available = await gitCLI.isAvailable();

      expect(available).toBe(false);
    });
  });
});
