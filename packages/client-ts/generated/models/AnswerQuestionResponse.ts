/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
export type AnswerQuestionResponse = {
    question_id: string;
    task_id: string;
    step_task_id?: string | null;
    status: AnswerQuestionResponse.status;
    /**
     * Whether answer was delivered to agent
     */
    delivered: boolean;
    /**
     * Error message if delivery failed
     */
    delivery_error?: string | null;
    message: string;
};
export namespace AnswerQuestionResponse {
    export enum status {
        ANSWERED = 'answered',
    }
}

