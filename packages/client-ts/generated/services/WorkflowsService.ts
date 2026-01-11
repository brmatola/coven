/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { ApproveMergeRequest } from '../models/ApproveMergeRequest';
import type { ApproveMergeResponse } from '../models/ApproveMergeResponse';
import type { RejectMergeRequest } from '../models/RejectMergeRequest';
import type { RejectMergeResponse } from '../models/RejectMergeResponse';
import type { WorkflowCancelResponse } from '../models/WorkflowCancelResponse';
import type { WorkflowDetailResponse } from '../models/WorkflowDetailResponse';
import type { WorkflowListResponse } from '../models/WorkflowListResponse';
import type { WorkflowRetryRequest } from '../models/WorkflowRetryRequest';
import type { WorkflowRetryResponse } from '../models/WorkflowRetryResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class WorkflowsService {
    /**
     * List all workflows
     * Returns a list of all workflows with their current status and metadata
     * @returns WorkflowListResponse Workflows list response
     * @throws ApiError
     */
    public static getWorkflows(): CancelablePromise<WorkflowListResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/workflows',
            errors: {
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Get workflow details
     * Returns detailed information about a workflow including steps, outputs, and available actions
     * @returns WorkflowDetailResponse Workflow details
     * @throws ApiError
     */
    public static getWorkflowById({
        id,
    }: {
        /**
         * Workflow ID or Task ID
         */
        id: string,
    }): CancelablePromise<WorkflowDetailResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/workflows/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `Workflow not found`,
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Get workflow log
     * Returns the JSONL log file for a workflow
     * @returns string JSONL log content
     * @throws ApiError
     */
    public static getWorkflowLog({
        id,
    }: {
        /**
         * Workflow ID or Task ID
         */
        id: string,
    }): CancelablePromise<string> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/workflows/{id}/log',
            path: {
                'id': id,
            },
            errors: {
                404: `Workflow not found`,
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Cancel a workflow
     * Cancels a running or blocked workflow and stops any associated agents
     * @returns WorkflowCancelResponse Cancel response
     * @throws ApiError
     */
    public static updateWorkflowCancel({
        id,
    }: {
        /**
         * Workflow ID or Task ID
         */
        id: string,
    }): CancelablePromise<WorkflowCancelResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/workflows/{id}/cancel',
            path: {
                'id': id,
            },
            errors: {
                400: `Workflow already in terminal state`,
                404: `Workflow not found`,
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Retry a blocked workflow
     * Retries a blocked or failed workflow, optionally with modified inputs
     * @returns WorkflowRetryResponse Retry response
     * @throws ApiError
     */
    public static createWorkflowRetry({
        id,
        requestBody,
    }: {
        /**
         * Workflow ID or Task ID
         */
        id: string,
        requestBody?: WorkflowRetryRequest,
    }): CancelablePromise<WorkflowRetryResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/workflows/{id}/retry',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Workflow is not in blocked or failed state`,
                404: `Workflow not found`,
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Approve workflow merge
     * Approves and merges workflow changes into the main repository
     * @returns ApproveMergeResponse Merge approval response
     * @throws ApiError
     */
    public static createWorkflowApproveMerge({
        id,
        requestBody,
    }: {
        /**
         * Workflow ID or Task ID
         */
        id: string,
        requestBody?: ApproveMergeRequest,
    }): CancelablePromise<ApproveMergeResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/workflows/{id}/approve-merge',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Workflow is not pending merge approval`,
                404: `Workflow not found`,
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Reject workflow merge
     * Rejects workflow changes and blocks the workflow
     * @returns RejectMergeResponse Reject response
     * @throws ApiError
     */
    public static updateWorkflowRejectMerge({
        id,
        requestBody,
    }: {
        /**
         * Workflow ID or Task ID
         */
        id: string,
        requestBody?: RejectMergeRequest,
    }): CancelablePromise<RejectMergeResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/workflows/{id}/reject-merge',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Workflow is not pending merge approval`,
                404: `Workflow not found`,
                405: `Method not allowed`,
            },
        });
    }
}
