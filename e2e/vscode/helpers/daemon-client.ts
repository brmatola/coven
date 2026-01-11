/**
 * Direct daemon client for E2E tests.
 * Bypasses the extension to verify daemon state directly.
 */

import * as http from 'http';
import * as path from 'path';
import * as fs from 'fs';

export interface DaemonHealth {
  status: string;
  version: string;
  uptime: string;
  workspace: string;
}

export interface DaemonTask {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
}

export interface DaemonAgent {
  taskId: string;
  status: string;
  pid?: number;
  startedAt?: string;
}

export interface DaemonState {
  agents: Record<string, DaemonAgent>;
  tasks: DaemonTask[];
}

export interface StateResponse {
  state: DaemonState;
  timestamp: string;
}

/**
 * HTTP client for direct daemon communication in tests.
 */
export class TestDaemonClient {
  private socketPath: string;

  constructor(workspacePath: string) {
    this.socketPath = path.join(workspacePath, '.coven', 'covend.sock');
  }

  /**
   * Check if daemon socket exists.
   */
  socketExists(): boolean {
    return fs.existsSync(this.socketPath);
  }

  /**
   * Make HTTP request to daemon.
   */
  private async request<T>(
    method: string,
    endpoint: string,
    body?: unknown,
    timeoutMs: number = 5000
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const options: http.RequestOptions = {
        socketPath: this.socketPath,
        path: endpoint,
        method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        timeout: timeoutMs,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            try {
              resolve(data ? JSON.parse(data) : ({} as T));
            } catch {
              reject(new Error(`Invalid JSON: ${data.substring(0, 100)}`));
            }
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${data}`));
          }
        });
      });

      req.on('error', (err) => reject(err));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  /**
   * Get daemon health status.
   */
  async getHealth(): Promise<DaemonHealth> {
    return this.request<DaemonHealth>('GET', '/health');
  }

  /**
   * Get full daemon state.
   */
  async getState(): Promise<StateResponse> {
    return this.request<StateResponse>('GET', '/state');
  }

  /**
   * Get tasks list.
   */
  async getTasks(): Promise<{ tasks: DaemonTask[]; count: number }> {
    return this.request<{ tasks: DaemonTask[]; count: number }>('GET', '/tasks');
  }

  /**
   * Start a task (spawn agent).
   */
  async startTask(taskId: string): Promise<void> {
    await this.request<void>('POST', `/tasks/${taskId}/start`);
  }

  /**
   * Stop/kill a task.
   */
  async stopTask(taskId: string): Promise<void> {
    await this.request<void>('POST', `/tasks/${taskId}/stop`);
  }

  /**
   * Kill an agent (alias for stopTask, matches daemon API).
   */
  async killTask(taskId: string): Promise<void> {
    await this.request<void>('POST', `/agents/${taskId}/kill`);
  }

  /**
   * Answer a question from an agent.
   */
  async answerQuestion(questionId: string, answer: string): Promise<void> {
    await this.request<void>('POST', `/questions/${questionId}/answer`, { answer });
  }

  /**
   * Get agents list.
   */
  async getAgents(): Promise<{ agents: DaemonAgent[]; count: number }> {
    return this.request<{ agents: DaemonAgent[]; count: number }>('GET', '/agents');
  }

  /**
   * Get agent output.
   */
  async getAgentOutput(
    taskId: string
  ): Promise<{ taskId: string; output: string[]; totalLines: number }> {
    return this.request<{ taskId: string; output: string[]; totalLines: number }>(
      'GET',
      `/agents/${taskId}/output`
    );
  }

  /**
   * Shutdown daemon.
   */
  async shutdown(): Promise<void> {
    try {
      await this.request<void>('POST', '/shutdown', undefined, 2000);
    } catch {
      // Shutdown may not respond as connection closes
    }
  }

  /**
   * Wait for daemon to be healthy.
   */
  async waitForHealthy(timeoutMs: number = 15000): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const health = await this.getHealth();
        if (health.status === 'healthy') {
          return;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Daemon not healthy within ${timeoutMs}ms`);
  }

  /**
   * Wait for a specific number of tasks to be available.
   */
  async waitForTasks(
    minCount: number,
    timeoutMs: number = 10000
  ): Promise<DaemonTask[]> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const result = await this.getTasks();
        if (result.tasks && result.tasks.length >= minCount) {
          return result.tasks;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(`Did not find ${minCount} tasks within ${timeoutMs}ms`);
  }

  /**
   * Wait for an agent to reach a specific status.
   */
  async waitForAgentStatus(
    taskId: string,
    status: string | string[],
    timeoutMs: number = 30000
  ): Promise<DaemonAgent> {
    const statuses = Array.isArray(status) ? status : [status];
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const result = await this.getAgents();
        const agents = result.agents || [];
        // Handle both array and object formats
        const agentList = Array.isArray(agents)
          ? agents
          : Object.entries(agents).map(([tid, a]) => ({
              ...(a as DaemonAgent),
              taskId: tid,
            }));

        const agent = agentList.find((a) => a.taskId === taskId);
        if (agent && statuses.includes(agent.status)) {
          return agent;
        }
      } catch {
        // Not ready yet
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error(
      `Agent ${taskId} did not reach status ${statuses.join('|')} within ${timeoutMs}ms`
    );
  }
}
