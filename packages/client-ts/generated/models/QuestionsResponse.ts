/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Question } from './Question';
export type QuestionsResponse = {
    questions: Array<Question>;
    /**
     * Total number of questions returned
     */
    count: number;
    /**
     * Total number of pending questions
     */
    pending_count: number;
};

