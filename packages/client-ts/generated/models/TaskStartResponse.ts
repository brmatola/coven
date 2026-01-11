/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TaskStartResponse = {
    task_id: string;
    status: TaskStartResponse.status;
    message: string | null;
};
export namespace TaskStartResponse {
    export enum status {
        STARTED = 'started',
        ALREADY_RUNNING = 'already_running',
    }
}

