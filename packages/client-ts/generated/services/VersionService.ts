/* generated using openapi-typescript-codegen -- do not edit */
/* istanbul ignore file */
/* tslint:disable */
/* eslint-disable */
import type { VersionInfo } from '../models/VersionInfo';
import type { CancelablePromise } from '../core/CancelablePromise';
import { OpenAPI } from '../core/OpenAPI';
import { request as __request } from '../core/request';
export class VersionService {
    /**
     * Get daemon version information
     * Returns version, git commit, build time, and Go version information
     * @returns VersionInfo Version information
     * @throws ApiError
     */
    public static getVersion(): CancelablePromise<VersionInfo> {
        return __request(OpenAPI, {
            method: 'GET',
            url: '/version',
            errors: {
                405: `Method not allowed`,
            },
        });
    }
}
