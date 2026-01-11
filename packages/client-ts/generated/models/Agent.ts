/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AgentStatus } from './AgentStatus';
export type Agent = {
    /**
     * Task ID this agent is working on
     */
    task_id: string;
    /**
     * Current step's process ID (for workflows)
     */
    step_task_id?: string;
    /**
     * Process ID
     */
    pid: number;
    status: AgentStatus;
    /**
     * Worktree path
     */
    worktree: string;
    /**
     * Git branch name
     */
    branch: string;
    started_at: string;
    ended_at?: string | null;
    exit_code?: number | null;
    /**
     * Error message if failed
     */
    error?: string;
};

