/**
 * Unix Socket Adapter for axios
 * 
 * Allows the generated OpenAPI client to work with Unix domain sockets
 * instead of HTTP URLs.
 */

import * as http from 'http';
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse, AxiosAdapter } from 'axios';

/**
 * Creates an axios adapter that uses Unix domain sockets
 */
export function createUnixSocketAdapter(socketPath: string): AxiosAdapter {
  return async (config: AxiosRequestConfig): Promise<AxiosResponse> => {
    return new Promise((resolve, reject) => {
      // AxiosRequestConfig properties are typed as any in axios types
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
      const method = (config.method || 'GET').toUpperCase() as string;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const url: string = (config.url || '/') as string;
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const timeout: number = (config.timeout || 30000) as number;

      // Extract path and query from URL
      let requestPath: string = url;
      
      // If URL is full (http://localhost/path?query), extract just the path+query
      if (typeof url === 'string' && (url.startsWith('http://') || url.startsWith('https://'))) {
        try {
          const urlObj = new URL(url);
          requestPath = urlObj.pathname + urlObj.search;
        } catch {
          requestPath = url;
        }
      }
      
      // Also handle axios params if present (for compatibility)
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (config.params) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-member-access
        const queryString = new URLSearchParams(config.params as Record<string, string>).toString();
        if (queryString) {
          requestPath = `${requestPath}${requestPath.includes('?') ? '&' : '?'}${queryString}`;
        }
      }

      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const configData = config.data;
      const bodyString: string | undefined =
        configData !== undefined
          ? typeof configData === 'string'
            ? configData
            // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
            : JSON.stringify(configData)
          : undefined;

      // Normalize headers from axios config
      // Axios 1.x uses AxiosHeaders class, not plain objects
      // We need to extract valid string headers and filter undefined values
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      };

      // Extract headers from config.headers, handling AxiosHeaders class
      if (config.headers) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const configHeaders = config.headers;
        if (typeof configHeaders === 'object') {
          // If it's an AxiosHeaders instance, it has a toJSON method
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          const headersObj = typeof (configHeaders as { toJSON?: () => Record<string, unknown> }).toJSON === 'function'
            // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
            ? (configHeaders as { toJSON: () => Record<string, unknown> }).toJSON()
            : configHeaders as Record<string, unknown>;

          // Only copy valid string values, skip undefined/null
          for (const [key, value] of Object.entries(headersObj)) {
            if (value !== undefined && value !== null && typeof value === 'string') {
              headers[key] = value;
            } else if (value !== undefined && value !== null) {
              headers[key] = String(value);
            }
          }
        }
      }

      // Add Content-Length if we have a body
      if (bodyString !== undefined) {
        headers['Content-Length'] = Buffer.byteLength(bodyString).toString();
      }

      const requestOptions: http.RequestOptions = {
        socketPath,
        path: requestPath,
        method,
        headers,
        timeout,
      };

      const req = http.request(requestOptions, (res) => {
        const data: Buffer[] = [];

        res.on('data', (chunk: Buffer) => {
          data.push(chunk);
        });

        res.on('end', () => {
          const responseData = Buffer.concat(data);
          const responseText = responseData.toString('utf-8');

          // Parse JSON response if present
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          let responseDataParsed: unknown = undefined;
          if (responseText.length > 0) {
            try {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              responseDataParsed = JSON.parse(responseText);
            } catch {
              responseDataParsed = responseText;
            }
          }

          // Build axios-compatible response
          // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
          const axiosResponse: AxiosResponse<any, any> = {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            data: responseDataParsed,
            status: res.statusCode || 200,
            statusText: res.statusMessage || 'OK',
            headers: res.headers as Record<string, string>,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any
            config: config as any,
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
            request: req,
          };

          // Reject on error status codes
          if (res.statusCode !== undefined && (res.statusCode < 200 || res.statusCode >= 300)) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
            const error = new axios.AxiosError(
              `Request failed with status code ${res.statusCode}`,
              'ERR_BAD_RESPONSE',
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              config as any,
              req,
              axiosResponse
            );
            // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
            error.response = axiosResponse;
            reject(error);
            return;
          }

          resolve(axiosResponse);
        });
      });

      req.on('error', (error: NodeJS.ErrnoException) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
        const axiosError = new axios.AxiosError(
          error.message,
          error.code === 'ECONNREFUSED' ? 'ECONNREFUSED' : error.code === 'ENOENT' ? 'ENOTFOUND' : 'ERR_NETWORK',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          config as any,
          req
        );
        reject(axiosError);
      });

      req.on('timeout', () => {
        req.destroy();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        const timeoutError = new axios.AxiosError('Request timeout', 'ETIMEDOUT', config as any, req);
        reject(timeoutError);
      });

      if (bodyString !== undefined) {
        req.write(bodyString);
      }

      req.end();
    });
  };
}

/**
 * Creates an axios instance configured for Unix socket communication
 */
export function createUnixSocketAxiosInstance(socketPath: string): AxiosInstance {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const adapter = createUnixSocketAdapter(socketPath);
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  const instance: AxiosInstance = axios.create({
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    adapter,
    baseURL: 'http://localhost',
  }) as AxiosInstance;
  return instance;
}
