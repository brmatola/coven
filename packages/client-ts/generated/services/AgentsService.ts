/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Agent } from '../models/Agent';
import type { AgentKillResponse } from '../models/AgentKillResponse';
import type { AgentOutputResponse } from '../models/AgentOutputResponse';
import type { AgentRespondRequest } from '../models/AgentRespondRequest';
import type { AgentRespondResponse } from '../models/AgentRespondResponse';
import type { AgentsResponse } from '../models/AgentsResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class AgentsService {
    /**
     * Get all agents
     * Returns a list of all active agents with their status and metadata
     * @returns AgentsResponse Agents response
     * @throws ApiError
     */
    public static getAgents(): CancelablePromise<AgentsResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/agents',
            errors: {
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Get agent by task ID
     * Returns the agent information for a specific task
     * @returns Agent Agent information
     * @throws ApiError
     */
    public static getAgentById({
        id,
    }: {
        /**
         * Agent/Task ID
         */
        id: string,
    }): CancelablePromise<Agent> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/agents/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `Agent not found`,
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Get agent output
     * Returns the output lines from an agent process, optionally filtered by sequence number
     * @returns AgentOutputResponse Agent output response
     * @throws ApiError
     */
    public static getAgentOutput({
        id,
        since,
    }: {
        /**
         * Agent/Task ID
         */
        id: string,
        /**
         * Return output since this sequence number
         */
        since?: number,
    }): CancelablePromise<AgentOutputResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/agents/{id}/output',
            path: {
                'id': id,
            },
            query: {
                'since': since,
            },
            errors: {
                404: `Agent not found`,
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Kill an agent
     * Terminates a running agent process
     * @returns AgentKillResponse Kill response
     * @throws ApiError
     */
    public static updateAgentKill({
        id,
    }: {
        /**
         * Agent/Task ID
         */
        id: string,
    }): CancelablePromise<AgentKillResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/agents/{id}/kill',
            path: {
                'id': id,
            },
            errors: {
                404: `Agent not found`,
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Send response to agent
     * Sends input to an agent's stdin (e.g., to answer a question)
     * @returns AgentRespondResponse Response sent confirmation
     * @throws ApiError
     */
    public static updateAgentRespond({
        id,
        requestBody,
    }: {
        /**
         * Agent/Task ID
         */
        id: string,
        requestBody: AgentRespondRequest,
    }): CancelablePromise<AgentRespondResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/agents/{id}/respond',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Invalid request`,
                404: `Agent not found`,
                405: `Method not allowed`,
            },
        });
    }
}
