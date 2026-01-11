/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type WorkflowCancelResponse = {
    status: WorkflowCancelResponse.status;
    workflow_id: string;
    task_id: string | null;
};
export namespace WorkflowCancelResponse {
    export enum status {
        CANCELLED = 'cancelled',
    }
}

