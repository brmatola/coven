/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { WorkflowStatus } from './WorkflowStatus';
export type WorkflowListItem = {
    workflow_id: string;
    task_id: string;
    grimoire_name: string;
    status: WorkflowStatus;
    /**
     * Current step index
     */
    current_step: number;
    /**
     * Path to worktree
     */
    worktree_path: string;
    started_at: string;
    updated_at: string;
    error?: string | null;
};

