/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { HealthStatus } from '../models/HealthStatus';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class HealthService {
    /**
     * Get daemon health status
     * Returns the current health status, version, uptime, and workspace of the daemon
     * @returns HealthStatus Health status response
     * @throws ApiError
     */
    public static getHealth(): CancelablePromise<HealthStatus> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/health',
            errors: {
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Shutdown daemon
     * Triggers a graceful shutdown of the daemon. The daemon will stop accepting new requests
     * and shut down after processing any in-flight requests.
     *
     * @returns any Shutdown initiated
     * @throws ApiError
     */
    public static shutdownDaemon(): CancelablePromise<{
        status?: string;
    }> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/shutdown',
            errors: {
                405: `Method not allowed`,
            },
        });
    }
}
