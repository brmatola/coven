/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorkflowState = {
    /**
     * Workflow ID
     */
    id: string;
    status: WorkflowState.status;
    started_at?: string;
    completed_at?: string;
};
export namespace WorkflowState {
    export enum status {
        IDLE = 'idle',
        RUNNING = 'running',
        PAUSED = 'paused',
        COMPLETED = 'completed',
        ERROR = 'error',
    }
}

