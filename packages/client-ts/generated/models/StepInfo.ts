/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { StepStatus } from './StepStatus';
export type StepInfo = {
    /**
     * Step ID
     */
    id: string;
    /**
     * Step name
     */
    name: string;
    /**
     * Step type
     */
    type: StepInfo.type;
    status: StepStatus;
    /**
     * Nesting depth (0 = top level)
     */
    depth: number;
    /**
     * Whether this is a loop step
     */
    is_loop?: boolean;
    /**
     * Maximum iterations for loop
     */
    max_iterations?: number | null;
    /**
     * Current iteration for loop
     */
    current_iteration?: number | null;
    /**
     * Error message if failed
     */
    error?: string | null;
};
export namespace StepInfo {
    /**
     * Step type
     */
    export enum type {
        AGENT = 'agent',
        SCRIPT = 'script',
        LOOP = 'loop',
        MERGE = 'merge',
    }
}

