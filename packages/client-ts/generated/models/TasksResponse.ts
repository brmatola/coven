/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { Task } from './Task';
export type TasksResponse = {
    tasks: Array<Task>;
    /**
     * Number of tasks
     */
    count: number;
    /**
     * Last time tasks were synced from beads
     */
    last_sync?: string;
};

