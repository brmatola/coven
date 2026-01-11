/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type RejectMergeResponse = {
    status: RejectMergeResponse.status;
    workflow_id: string;
    task_id: string;
    reason: string;
};
export namespace RejectMergeResponse {
    export enum status {
        REJECTED = 'rejected',
    }
}

