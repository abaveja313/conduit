/**
 * Standard error codes for the Conduit system
 * Follows JSON-RPC 2.0 error code conventions with custom extensions
 */
export const ErrorCodes = {
    // JSON-RPC 2.0 standard errors (-32768 to -32000)
    PARSE_ERROR: -32700,
    INVALID_REQUEST: -32600,
    METHOD_NOT_FOUND: -32601,
    INVALID_PARAMS: -32602,
    INTERNAL_ERROR: -32603,

    // Application-specific errors (-32000 to -32099)
    WASM_LOAD_ERROR: -32000,
    TOOL_EXECUTION_ERROR: -32001,
    CANCELLED: -32002,
    FILE_ACCESS_ERROR: -32003,
    PERMISSION_DENIED: -32004,
    TRANSPORT_ERROR: -32005,
    INITIALIZATION_ERROR: -32006,
    VALIDATION_ERROR: -32007,
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/**
 * Base error class for all Conduit errors
 * Provides consistent error structure across packages
 */
export class ConduitError extends Error {
    public readonly code: ErrorCode;
    public readonly timestamp: Date;
    public readonly context?: Record<string, unknown>;

    constructor(message: string, code: ErrorCode, context?: Record<string, unknown>) {
        super(message);
        this.name = 'ConduitError';
        this.code = code;
        this.timestamp = new Date();
        this.context = context;

        // Maintains proper stack trace
        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, ConduitError);
        }
    }

    /**
     * Convert error to JSON-RPC error format
     */
    toJSON(): ErrorResponse {
        return {
            code: this.code.toString(),
            message: this.message,
            details: {
                name: this.name,
                timestamp: this.timestamp.toISOString(),
                ...this.context,
            },
        };
    }
}

/**
 * Type guard for ConduitError
 */
export const isConduitError = (error: unknown): error is ConduitError => {
    return error instanceof ConduitError;
};

/**
 * Check if an error is an abort/cancellation error
 */
export const isAbortError = (error: unknown): boolean => {
    if (error instanceof DOMException && error.name === 'AbortError') return true;
    if (error instanceof Error) {
        return (
            error.name === 'AbortError' ||
            error.message.toLowerCase().includes('abort') ||
            error.message.toLowerCase().includes('cancel')
        );
    }
    return false;
};

/**
 * Create a standard cancellation error
 */
export const createCancelledError = (context?: Record<string, unknown>): ConduitError => {
    return new ConduitError('Operation cancelled', ErrorCodes.CANCELLED, context);
};

/**
 * Safely extract error message from unknown error type
 */
export const getErrorMessage = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === 'string') return error;
    if (error && typeof error === 'object' && 'message' in error) {
        return String(error.message);
    }
    return 'Unknown error';
};

/**
 * Extract error code from various error types
 */
export const getErrorCode = (error: unknown): ErrorCode => {
    if (isConduitError(error)) return error.code;
    if (error instanceof Error && 'code' in error) {
        const code = Number(error.code);
        if (!isNaN(code) && Object.values(ErrorCodes).includes(code as ErrorCode)) {
            return code as ErrorCode;
        }
    }
    return ErrorCodes.INTERNAL_ERROR;
};

/**
 * Wrap unknown errors in ConduitError
 */
export const wrapError = (
    error: unknown,
    code: ErrorCode = ErrorCodes.INTERNAL_ERROR,
    context?: Record<string, unknown>,
): ConduitError => {
    if (isConduitError(error)) return error;

    const message = getErrorMessage(error);
    const errorContext: Record<string, unknown> = { ...context };

    if (error instanceof Error) {
        errorContext.originalError = error.name;
        if (error.stack) errorContext.stack = error.stack;
    }

    return new ConduitError(message, code, errorContext);
};

// Import ErrorResponse type from existing types
import type { ErrorResponse } from './types.js';
