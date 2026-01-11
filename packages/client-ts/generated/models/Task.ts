/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { TaskStatus } from './TaskStatus';
export type Task = {
    /**
     * Task ID
     */
    id: string;
    /**
     * Task title
     */
    title: string;
    /**
     * Task description
     */
    description?: string;
    status: TaskStatus;
    /**
     * Priority (higher = more important)
     */
    priority: number;
    /**
     * Task type
     */
    type: Task.type;
    /**
     * Task labels
     */
    labels?: Array<string>;
    /**
     * Task IDs this task depends on
     */
    depends_on?: Array<string>;
    /**
     * Task IDs blocked by this task
     */
    blocks?: Array<string>;
    created_at: string;
    updated_at: string;
};
export namespace Task {
    /**
     * Task type
     */
    export enum type {
        TASK = 'task',
        BUG = 'bug',
        FEATURE = 'feature',
        EPIC = 'epic',
    }
}

