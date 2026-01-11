/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AnswerQuestionRequest } from '../models/AnswerQuestionRequest';
import type { AnswerQuestionResponse } from '../models/AnswerQuestionResponse';
import type { Question } from '../models/Question';
import type { QuestionsResponse } from '../models/QuestionsResponse';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class QuestionsService {
    /**
     * Get all questions
     * Returns a list of pending questions, optionally filtered by task ID
     * @returns QuestionsResponse Questions response
     * @throws ApiError
     */
    public static getQuestions({
        taskId,
        pending,
    }: {
        /**
         * Filter by task ID
         */
        taskId?: string,
        /**
         * Include only pending questions (default true)
         */
        pending?: boolean,
    }): CancelablePromise<QuestionsResponse> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/questions',
            query: {
                'task_id': taskId,
                'pending': pending,
            },
            errors: {
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Get question by ID
     * Returns a specific question by its ID
     * @returns Question Question information
     * @throws ApiError
     */
    public static getQuestionById({
        id,
    }: {
        /**
         * Question ID
         */
        id: string,
    }): CancelablePromise<Question> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/questions/{id}',
            path: {
                'id': id,
            },
            errors: {
                404: `Question not found`,
                405: `Method not allowed`,
            },
        });
    }
    /**
     * Answer a question
     * Records an answer to a pending question and delivers it to the agent
     * @returns AnswerQuestionResponse Answer response
     * @throws ApiError
     */
    public static createQuestionAnswer({
        id,
        requestBody,
    }: {
        /**
         * Question ID
         */
        id: string,
        requestBody: AnswerQuestionRequest,
    }): CancelablePromise<AnswerQuestionResponse> {
        return __request(OpenAPI, {
            method: 'POST',
            url: '/questions/{id}/answer',
            path: {
                'id': id,
            },
            body: requestBody,
            mediaType: 'application/json',
            errors: {
                400: `Invalid request`,
                404: `Question not found`,
                405: `Method not allowed`,
                409: `Question already answered`,
            },
        });
    }
}
