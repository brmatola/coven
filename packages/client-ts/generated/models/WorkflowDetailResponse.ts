/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { MergeReview } from './MergeReview';
import type { StepInfo } from './StepInfo';
import type { StepResult } from './StepResult';
import type { WorkflowStatus } from './WorkflowStatus';
export type WorkflowDetailResponse = {
    workflow_id: string;
    task_id: string;
    grimoire_name: string;
    status: WorkflowStatus;
    current_step: number;
    worktree_path: string;
    started_at: string;
    updated_at: string;
    error?: string | null;
    steps: Array<StepInfo>;
    completed_steps?: Record<string, StepResult>;
    step_outputs?: Record<string, string | null>;
    merge_review?: MergeReview;
    /**
     * Available actions for this workflow
     */
    available_actions: Array<string>;
};

