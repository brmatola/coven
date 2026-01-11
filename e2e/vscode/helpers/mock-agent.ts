/**
 * Mock agent configuration helper for E2E tests.
 *
 * Provides utilities to configure the daemon to use a mock agent
 * for deterministic, fast testing without Claude API calls.
 */
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';

/**
 * Options for mock agent behavior.
 */
export interface MockAgentOptions {
  /** Delay before completing (e.g., "100ms", "1s") */
  delay?: string;
  /** Exit with non-zero code */
  fail?: boolean;
  /** Output a question and wait for response */
  question?: boolean;
  /** Custom output text */
  output?: string;
  /** Exit with specific code */
  exitCode?: number;
}

/**
 * Preset configurations for common test scenarios.
 */
export const MockAgentPresets: Record<string, MockAgentOptions> = {
  /** Fast completion for basic tests */
  fast: { delay: '100ms' },
  /** Slow agent for timeout testing */
  slow: { delay: '30s' },
  /** Agent that fails */
  failing: { fail: true },
  /** Agent that asks a question */
  questioning: { question: true },
};

/**
 * Create a mock agent options with custom output.
 */
export function withOutput(text: string): MockAgentOptions {
  return { output: text };
}

/**
 * Helper for configuring mock agent in E2E tests.
 *
 * Usage:
 * ```typescript
 * const mockAgent = new MockAgentConfigurator(workspacePath);
 * await mockAgent.ensureBuilt();
 * mockAgent.configure({ delay: '200ms' });
 * // Now daemon will use mock agent with 200ms delay
 * ```
 */
export class MockAgentConfigurator {
  private readonly workspacePath: string;
  private readonly mockAgentPath: string;
  private readonly covenDir: string;
  private readonly configPath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
    this.covenDir = path.join(workspacePath, '.coven');
    this.configPath = path.join(this.covenDir, 'config.json');

    // Find mock agent binary
    // Go up from e2e/vscode/out/helpers to repo root (4 levels)
    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    this.mockAgentPath = path.join(repoRoot, 'build', 'mockagent');
  }

  /**
   * Ensure the mock agent binary is built.
   *
   * @throws Error if build fails
   */
  async ensureBuilt(): Promise<void> {
    if (fs.existsSync(this.mockAgentPath)) {
      return;
    }

    const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
    try {
      console.log('Building mock agent...');
      execSync('make build-mockagent', {
        cwd: repoRoot,
        stdio: 'pipe',
      });
    } catch (err) {
      throw new Error(
        `Failed to build mock agent. Run 'make build-mockagent' manually. ` +
          `Error: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /**
   * Get the path to the mock agent binary.
   */
  getMockAgentPath(): string {
    return this.mockAgentPath;
  }

  /**
   * Check if mock agent binary exists.
   */
  isBuilt(): boolean {
    return fs.existsSync(this.mockAgentPath);
  }

  /**
   * Configure daemon to use mock agent with specified options.
   *
   * Creates a wrapper script that passes the correct flags to mockagent.
   *
   * @param options Mock agent behavior options
   */
  configure(options: MockAgentOptions = {}): void {
    // Ensure .coven directory exists
    fs.mkdirSync(this.covenDir, { recursive: true });

    // Build command with flags
    const args = this.buildArgs(options);
    const agentCommand = args.length > 0
      ? `${this.mockAgentPath} ${args.join(' ')}`
      : this.mockAgentPath;

    // Read existing config or create new one
    let config: Record<string, unknown> = {};
    if (fs.existsSync(this.configPath)) {
      try {
        config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      } catch {
        // Ignore invalid config
      }
    }

    // Update agent_command
    config.agent_command = agentCommand;

    // Set reasonable defaults for testing
    if (!config.poll_interval) {
      config.poll_interval = 1; // Fast polling for tests
    }
    if (!config.max_concurrent_agents) {
      config.max_concurrent_agents = 1;
    }
    if (!config.log_level) {
      config.log_level = 'debug';
    }

    // Write config
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Configure daemon with a preset.
   */
  configureWithPreset(preset: keyof typeof MockAgentPresets | MockAgentOptions): void {
    const options = typeof preset === 'string' ? MockAgentPresets[preset] : preset;
    this.configure(options);
  }

  /**
   * Reset daemon configuration to use default agent (claude).
   */
  resetToDefault(): void {
    if (!fs.existsSync(this.configPath)) {
      return;
    }

    let config: Record<string, unknown> = {};
    try {
      config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
    } catch {
      return;
    }

    // Remove agent_command to use default
    delete config.agent_command;
    fs.writeFileSync(this.configPath, JSON.stringify(config, null, 2));
  }

  /**
   * Get the current agent command from config.
   */
  getCurrentAgentCommand(): string | null {
    if (!fs.existsSync(this.configPath)) {
      return null;
    }

    try {
      const config = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      return config.agent_command ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Build command-line arguments from options.
   */
  private buildArgs(options: MockAgentOptions): string[] {
    const args: string[] = [];

    if (options.delay) {
      args.push('-delay', options.delay);
    }
    if (options.fail) {
      args.push('-fail');
    }
    if (options.question) {
      args.push('-question');
    }
    if (options.output) {
      args.push('-output', `"${options.output}"`);
    }
    if (options.exitCode !== undefined) {
      args.push('-exit-code', String(options.exitCode));
    }

    return args;
  }
}

/**
 * Create a MockAgentConfigurator for the given workspace.
 */
export function createMockAgentConfigurator(workspacePath: string): MockAgentConfigurator {
  return new MockAgentConfigurator(workspacePath);
}
