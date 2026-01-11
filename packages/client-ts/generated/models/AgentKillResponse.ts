/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AgentKillResponse = {
    task_id: string;
    status: AgentKillResponse.status;
    message: string | null;
};
export namespace AgentKillResponse {
    export enum status {
        KILLED = 'killed',
    }
}

