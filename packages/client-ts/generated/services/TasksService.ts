/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TasksResponse } from '../models/TasksResponse';
import type { TaskStartResponse } from '../models/TaskStartResponse';
import type { TaskStopResponse } from '../models/TaskStopResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class TasksService {
    /**
     * Get all tasks
     * Returns a list of all tasks from beads with their current status
     * @returns TasksResponse Tasks response
     * @throws ApiError
     */
    public static getTasks(): CancelablePromise<TasksResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/tasks',
            errors: {
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Start a task
     * Starts an agent to work on a specific task
     * @returns TaskStartResponse Start response
     * @throws ApiError
     */
    public static startTask({
        id,
    }: {
        /**
         * Task ID
         */
        id: string,
    }): CancelablePromise<TaskStartResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tasks/{id}/start',
            path: {
                'id': id,
            },
            errors: {
                404: `Task not found`,
                405: `Method not allowed`,
                500: `Failed to start agent`,
            },
        });
    }
    /**
     * Stop a task
     * Stops the agent working on a specific task
     * @returns TaskStopResponse Stop response
     * @throws ApiError
     */
    public static stopTask({
        id,
    }: {
        /**
         * Task ID
         */
        id: string,
    }): CancelablePromise<TaskStopResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/tasks/{id}/stop',
            path: {
                'id': id,
            },
            errors: {
                404: `No agent running for task`,
                405: `Method not allowed`,
            },
        });
    }
}
