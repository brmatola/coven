/**
 * Coven Daemon API Client
 * 
 * Provides a typed client for communicating with the Coven daemon over Unix sockets.
 * Uses the generated OpenAPI client with Unix socket adapter.
 */

import { createUnixSocketAxiosInstance } from './unix-socket-adapter';
import type { AxiosInstance } from 'axios';
import type { OpenAPIConfig } from '../generated/core/OpenAPI';
import type { ApiRequestOptions } from '../generated/core/ApiRequestOptions';
import type { CancelablePromise } from '../generated/core/CancelablePromise';

// Type definitions for the generated request module
type RequestFunction = <T>(
  config: OpenAPIConfig,
  options: ApiRequestOptions,
  axiosClient?: AxiosInstance
) => CancelablePromise<T>;

interface RequestModule {
  request: RequestFunction;
}

// Global axios instance for patching - set before services are imported
let globalAxiosInstance: AxiosInstance | null = null;

/**
 * Patches the generated request module to use a Unix socket axios instance.
 * Must be called before any services are imported.
 */
function patchRequestModule(axiosInstance: AxiosInstance): void {
  globalAxiosInstance = axiosInstance;
  
  // Import the request module - this will be cached by Node.js
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
  const requestModule = require('../generated/core/request') as RequestModule;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
  const originalRequest = requestModule.request;
  
  // Replace the request function to inject our Unix socket axios instance
  // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
  requestModule.request = function <T>(
    config: OpenAPIConfig,
    options: ApiRequestOptions,
    axiosClient?: AxiosInstance
  ): CancelablePromise<T> {
    // Always use our Unix socket axios instance unless explicitly overridden
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
    return originalRequest(config, options, axiosClient || globalAxiosInstance!);
  };
}

/**
 * Coven Daemon API Client
 * 
 * Provides typed access to all daemon API endpoints via Unix socket.
 * 
 * Usage:
 *   const client = new CovenClient('/path/to/socket');
 *   const health = await client.HealthService.getHealth();
 */
export class CovenClient {
  private socketPath: string;
  private axiosInstance: AxiosInstance;
  private services: typeof import('../generated');

  constructor(socketPath: string) {
    this.socketPath = socketPath;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    this.axiosInstance = createUnixSocketAxiosInstance(socketPath);
    
    // Patch BEFORE importing services
    patchRequestModule(this.axiosInstance);
    
    // Now import services - they will use our patched request function
    // Use dynamic import that resolves at runtime to dist/generated
    // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-unsafe-assignment
    this.services = require('../generated/index');
  }

  /**
   * Get the Unix socket path
   */
  getSocketPath(): string {
    return this.socketPath;
  }

  /**
   * Get the axios instance (for advanced usage)
   */
  getAxiosInstance(): AxiosInstance {
    return this.axiosInstance;
  }

  // Re-export all services - they will automatically use Unix sockets
  get HealthService() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return this.services.HealthService;
  }

  get VersionService() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return this.services.VersionService;
  }

  get StateService() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return this.services.StateService;
  }

  get TasksService() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return this.services.TasksService;
  }

  get AgentsService() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return this.services.AgentsService;
  }

  get QuestionsService() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return this.services.QuestionsService;
  }

  get WorkflowsService() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return this.services.WorkflowsService;
  }

  get EventsService() {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-member-access
    return this.services.EventsService;
  }
}
