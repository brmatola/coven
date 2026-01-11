/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AgentRespondResponse = {
    task_id: string;
    status: AgentRespondResponse.status;
    message: string;
};
export namespace AgentRespondResponse {
    export enum status {
        SENT = 'sent',
    }
}

