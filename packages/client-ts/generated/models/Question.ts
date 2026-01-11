/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { QuestionType } from './QuestionType';
import type { WorkflowContext } from './WorkflowContext';
export type Question = {
    /**
     * Question ID
     */
    id: string;
    /**
     * Task ID this question is for
     */
    task_id: string;
    /**
     * Agent ID that asked the question
     */
    agent_id: string;
    /**
     * Question text
     */
    text: string;
    type: QuestionType;
    /**
     * Available options (for choice questions)
     */
    options?: Array<string>;
    asked_at: string;
    answered_at?: string;
    answer?: string | null;
    context?: WorkflowContext;
};

