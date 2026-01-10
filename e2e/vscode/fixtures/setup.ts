/**
 * Fixture setup utilities for E2E tests.
 *
 * Creates test workspaces with various configurations for different test scenarios.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';

/**
 * Get the repository root directory.
 */
function getRepoRoot(): string {
  return path.resolve(__dirname, '..', '..', '..');
}

/**
 * Get the path to the mock agent binary.
 * Returns null if not built.
 */
function getMockAgentPath(): string | null {
  const repoRoot = getRepoRoot();
  const mockAgentPath = path.join(repoRoot, 'build', 'mockagent');
  if (fs.existsSync(mockAgentPath)) {
    return mockAgentPath;
  }
  return null;
}

/**
 * Build the mock agent if not already built.
 * @returns Path to the mock agent binary
 */
export function ensureMockAgentBuilt(): string {
  const existing = getMockAgentPath();
  if (existing) {
    return existing;
  }

  const repoRoot = getRepoRoot();
  console.log('Building mock agent...');
  try {
    execSync('make build-mockagent', {
      cwd: repoRoot,
      stdio: 'pipe',
    });
  } catch (err) {
    const error = err as { message?: string };
    throw new Error(`Failed to build mock agent: ${error.message || 'Unknown error'}`);
  }

  const newPath = getMockAgentPath();
  if (!newPath) {
    throw new Error('Mock agent build succeeded but binary not found');
  }
  return newPath;
}

/**
 * Mock agent configuration options.
 */
export interface MockAgentConfig {
  /** Delay before completing (e.g., "100ms", "1s") */
  delay?: string;
  /** Whether to simulate failure */
  fail?: boolean;
  /** Exit code (default: 0) */
  exitCode?: number;
  /** Custom output text */
  output?: string;
  /** Whether to output a question */
  question?: boolean;
}

/**
 * Fixture configuration for different test scenarios.
 */
export interface FixtureConfig {
  /** Initialize git repository */
  git?: boolean;
  /** Initialize .coven/ directory */
  coven?: boolean;
  /** Initialize .beads/ with sample beads */
  beads?: boolean;
  /** Create sample source files */
  sourceFiles?: boolean;
  /** Create sample grimoire */
  grimoire?: boolean;
  /** Configure mock agent for E2E testing */
  mockAgent?: boolean | MockAgentConfig;
  /** Additional files to create: path -> content */
  files?: Record<string, string>;
}

/**
 * Preset fixture configurations.
 */
export const presets = {
  /** Full workspace with all components initialized and mock agent */
  complete: {
    git: true,
    coven: true,
    beads: true,
    sourceFiles: true,
    grimoire: true,
    mockAgent: true,
  } as FixtureConfig,

  /** Git repo without coven initialization */
  uninitialized: {
    git: true,
    coven: false,
    beads: false,
    sourceFiles: true,
  } as FixtureConfig,

  /** No git repository */
  noGit: {
    git: false,
    coven: false,
    beads: false,
    sourceFiles: true,
  } as FixtureConfig,

  /** Minimal - just git and beads */
  minimal: {
    git: true,
    coven: false,
    beads: true,
    sourceFiles: false,
  } as FixtureConfig,

  /** Full workspace with mock agent configured to fail */
  failingAgent: {
    git: true,
    coven: true,
    beads: true,
    sourceFiles: true,
    grimoire: true,
    mockAgent: { fail: true },
  } as FixtureConfig,

  /** Full workspace with mock agent that asks questions */
  questionAgent: {
    git: true,
    coven: true,
    beads: true,
    sourceFiles: true,
    grimoire: true,
    mockAgent: { question: true },
  } as FixtureConfig,
};

/**
 * Sample bead YAML content for different states.
 */
export const sampleBeads = {
  pending: `id: beads-test-pending
title: "Test pending task"
type: task
status: open
priority: 2
description: A task ready to be started
created: "2024-01-01T00:00:00Z"
created_by: test
`,

  active: `id: beads-test-active
title: "Test active task"
type: task
status: in_progress
priority: 1
description: A task currently being worked on
created: "2024-01-01T00:00:00Z"
created_by: test
`,

  completed: `id: beads-test-completed
title: "Test completed task"
type: task
status: closed
priority: 2
description: A task that was completed
close_reason: "Task completed successfully"
created: "2024-01-01T00:00:00Z"
created_by: test
`,

  blocked: `id: beads-test-blocked
title: "Test blocked task"
type: task
status: open
priority: 2
description: A task blocked by another
depends_on:
  - beads-test-pending
created: "2024-01-01T00:00:00Z"
created_by: test
`,
};

/**
 * Sample grimoire YAML content.
 */
export const sampleGrimoire = `name: default
description: Default workflow for testing
version: "1.0"

steps:
  - name: implement
    type: agent
    spell: implement
    description: Implement the requested changes

  - name: test
    type: script
    command: npm test
    description: Run the test suite
    on_failure: stop

  - name: merge
    type: merge
    description: Review and merge changes
`;

/**
 * Sample source file content.
 */
export const sampleSource = `// Sample TypeScript file for testing
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`;

/**
 * Create a test workspace with the given configuration.
 */
export function createWorkspace(
  name: string,
  config: FixtureConfig
): { workspacePath: string; cleanup: () => void } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), `coven-e2e-${name}-`));

  try {
    // Initialize git if requested
    if (config.git) {
      execSync('git init', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.email "test@example.com"', { cwd: tempDir, stdio: 'pipe' });
      execSync('git config user.name "Test User"', { cwd: tempDir, stdio: 'pipe' });
    }

    // Create source files
    if (config.sourceFiles) {
      const srcDir = path.join(tempDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(path.join(srcDir, 'index.ts'), sampleSource);
      fs.writeFileSync(path.join(tempDir, 'README.md'), '# Test Workspace\n\nCreated for E2E testing.\n');
    }

    // Create .coven directory
    if (config.coven) {
      const covenDir = path.join(tempDir, '.coven');
      fs.mkdirSync(covenDir, { recursive: true });

      // Build config content
      let configContent = 'version: 1\nworkspace: .\n';

      // Set up mock agent if configured
      if (config.mockAgent) {
        const mockAgentPath = ensureMockAgentBuilt();
        const binDir = path.join(covenDir, 'bin');
        fs.mkdirSync(binDir, { recursive: true });

        // Copy mock agent to workspace
        const destPath = path.join(binDir, 'mockagent');
        fs.copyFileSync(mockAgentPath, destPath);
        fs.chmodSync(destPath, 0o755);

        // Build agent command with flags
        let agentCommand = destPath;
        if (typeof config.mockAgent === 'object') {
          const opts = config.mockAgent;
          if (opts.delay) agentCommand += ` -delay ${opts.delay}`;
          if (opts.fail) agentCommand += ' -fail';
          if (opts.exitCode !== undefined) agentCommand += ` -exit-code ${opts.exitCode}`;
          if (opts.output) agentCommand += ` -output "${opts.output}"`;
          if (opts.question) agentCommand += ' -question';
        }

        configContent += `agent_command: ${agentCommand}\n`;
      }

      fs.writeFileSync(path.join(covenDir, 'config.yaml'), configContent);

      if (config.grimoire) {
        const grimoireDir = path.join(covenDir, 'grimoires');
        fs.mkdirSync(grimoireDir, { recursive: true });
        fs.writeFileSync(path.join(grimoireDir, 'default.yaml'), sampleGrimoire);
      }
    }

    // Create .beads directory
    if (config.beads) {
      const beadsDir = path.join(tempDir, '.beads');
      fs.mkdirSync(beadsDir, { recursive: true });

      // Write config
      fs.writeFileSync(
        path.join(beadsDir, 'config.yaml'),
        'version: 1\nproject: test-project\n'
      );

      // Write sample beads
      fs.writeFileSync(path.join(beadsDir, 'beads-test-pending.yaml'), sampleBeads.pending);
      fs.writeFileSync(path.join(beadsDir, 'beads-test-active.yaml'), sampleBeads.active);
      fs.writeFileSync(path.join(beadsDir, 'beads-test-completed.yaml'), sampleBeads.completed);
      fs.writeFileSync(path.join(beadsDir, 'beads-test-blocked.yaml'), sampleBeads.blocked);
    }

    // Create additional files
    if (config.files) {
      for (const [filePath, content] of Object.entries(config.files)) {
        const fullPath = path.join(tempDir, filePath);
        fs.mkdirSync(path.dirname(fullPath), { recursive: true });
        fs.writeFileSync(fullPath, content);
      }
    }

    // Create initial commit if git is enabled
    if (config.git) {
      execSync('git add -A', { cwd: tempDir, stdio: 'pipe' });
      execSync('git commit -m "Initial test workspace setup" --allow-empty', {
        cwd: tempDir,
        stdio: 'pipe',
      });
    }
  } catch (err) {
    cleanupWorkspace(tempDir);
    throw err;
  }

  return {
    workspacePath: tempDir,
    cleanup: () => cleanupWorkspace(tempDir),
  };
}

/**
 * Create a workspace from a preset configuration.
 */
export function createPresetWorkspace(
  preset: keyof typeof presets
): { workspacePath: string; cleanup: () => void } {
  return createWorkspace(preset, presets[preset]);
}

/**
 * Clean up a workspace directory.
 */
function cleanupWorkspace(workspacePath: string, retries = 3): void {
  for (let i = 0; i < retries; i++) {
    try {
      fs.rmSync(workspacePath, { recursive: true, force: true });
      return;
    } catch {
      if (i < retries - 1) {
        // Brief delay before retry (sync)
        const start = Date.now();
        while (Date.now() - start < 100 * (i + 1)) {
          // spin
        }
      }
    }
  }
}

/**
 * Create a bead file in a workspace.
 */
export function createBead(
  workspacePath: string,
  id: string,
  content: string
): void {
  const beadsDir = path.join(workspacePath, '.beads');
  fs.mkdirSync(beadsDir, { recursive: true });
  fs.writeFileSync(path.join(beadsDir, `${id}.yaml`), content);
}

/**
 * Create a grimoire file in a workspace.
 */
export function createGrimoire(
  workspacePath: string,
  name: string,
  content: string
): void {
  const grimoireDir = path.join(workspacePath, '.coven', 'grimoires');
  fs.mkdirSync(grimoireDir, { recursive: true });
  fs.writeFileSync(path.join(grimoireDir, `${name}.yaml`), content);
}
