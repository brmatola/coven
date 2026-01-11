/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type HealthStatus = {
    /**
     * Health status of the daemon
     */
    status: HealthStatus.status;
    /**
     * Daemon version
     */
    version: string;
    /**
     * Uptime in milliseconds
     */
    uptime: number;
    /**
     * Workspace path
     */
    workspace: string;
};
export namespace HealthStatus {
    /**
     * Health status of the daemon
     */
    export enum status {
        OK = 'ok',
        DEGRADED = 'degraded',
        ERROR = 'error',
    }
}

