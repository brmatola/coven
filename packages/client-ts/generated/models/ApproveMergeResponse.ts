/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type ApproveMergeResponse = {
    status: ApproveMergeResponse.status;
    workflow_id: string;
    task_id: string;
    message: string;
    /**
     * Merge commit hash
     */
    merge_commit?: string | null;
    has_conflicts?: boolean | null;
    conflict_files?: Array<string | null>;
};
export namespace ApproveMergeResponse {
    export enum status {
        MERGED = 'merged',
        CONFLICTS = 'conflicts',
    }
}

