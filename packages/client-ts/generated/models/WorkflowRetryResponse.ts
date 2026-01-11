/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorkflowRetryResponse = {
    status: WorkflowRetryResponse.status;
    workflow_id: string;
    task_id: string;
    message: string | null;
};
export namespace WorkflowRetryResponse {
    export enum status {
        QUEUED = 'queued',
    }
}

