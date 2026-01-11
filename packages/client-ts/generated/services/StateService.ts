/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StateResponse } from '../models/StateResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class StateService {
    /**
     * Get daemon state
     * Returns the complete current state of the daemon including workflows, tasks, agents, and questions
     * @returns StateResponse Daemon state response
     * @throws ApiError
     */
    public static getState(): CancelablePromise<StateResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/state',
            errors: {
                405: `Method not allowed`,
            },
        });
    }
}
