/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { AgentOutputLine } from './AgentOutputLine';
export type AgentOutputResponse = {
    task_id: string;
    lines: Array<AgentOutputLine>;
    line_count: number;
    /**
     * Last sequence number
     */
    last_seq?: number;
};

