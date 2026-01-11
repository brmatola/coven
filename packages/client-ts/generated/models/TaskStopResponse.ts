/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type TaskStopResponse = {
    task_id: string;
    status: TaskStopResponse.status;
    message: string;
};
export namespace TaskStopResponse {
    export enum status {
        STOPPED = 'stopped',
    }
}

