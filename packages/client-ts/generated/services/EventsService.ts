/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class EventsService {
    /**
     * Stream server-sent events
     * Establishes a Server-Sent Events (SSE) stream for real-time event notifications.
     *
     * The connection remains open and events are streamed as they occur. The stream
     * starts with an initial state snapshot, then streams events as they happen.
     *
     * Events include:
     * - State snapshots (periodic heartbeats)
     * - Agent lifecycle events (started, output, completed, failed)
     * - Task updates
     * - Workflow events (started, step progress, blocked, completed)
     * - Questions from agents
     *
     * The client should reconnect automatically if the connection is lost.
     *
     * @returns string Event stream
     * @throws ApiError
     */
    public static getEvents({
        lastEventId,
    }: {
        /**
         * Last received event ID for resuming stream
         */
        lastEventId?: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/events',
            headers: {
                'Last-Event-ID': lastEventId,
            },
            responseHeader: 'Content-Type',
            errors: {
                400: `Bad request`,
                500: `Streaming not supported or server error`,
            },
        });
    }
}
