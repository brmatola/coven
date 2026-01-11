/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Agent } from './Agent';
import type { Task } from './Task';
import type { WorkflowState } from './WorkflowState';
export type DaemonState = {
    workflow?: (WorkflowState & null);
    /**
     * Map of task IDs to agent state
     */
    agents: Record<string, Agent>;
    /**
     * List of tasks from beads
     */
    tasks: Array<Task>;
    /**
     * Last time tasks were synced from beads
     */
    last_task_sync?: string;
};

