import { describe, it, expect } from 'vitest';
import {
  ErrorCodes,
  ConduitError,
  isConduitError,
  isAbortError,
  createCancelledError,
  getErrorMessage,
  getErrorCode,
  wrapError,
} from '../errors';

describe('ErrorCodes', () => {
  it('should have standard JSON-RPC error codes', () => {
    expect(ErrorCodes.PARSE_ERROR).toBe(-32700);
    expect(ErrorCodes.INVALID_REQUEST).toBe(-32600);
    expect(ErrorCodes.METHOD_NOT_FOUND).toBe(-32601);
    expect(ErrorCodes.INVALID_PARAMS).toBe(-32602);
    expect(ErrorCodes.INTERNAL_ERROR).toBe(-32603);
  });

  it('should have application-specific error codes', () => {
    expect(ErrorCodes.WASM_LOAD_ERROR).toBe(-32000);
    expect(ErrorCodes.TOOL_EXECUTION_ERROR).toBe(-32001);
    expect(ErrorCodes.CANCELLED).toBe(-32002);
    expect(ErrorCodes.FILE_ACCESS_ERROR).toBe(-32003);
    expect(ErrorCodes.PERMISSION_DENIED).toBe(-32004);
    expect(ErrorCodes.TRANSPORT_ERROR).toBe(-32005);
    expect(ErrorCodes.INITIALIZATION_ERROR).toBe(-32006);
    expect(ErrorCodes.VALIDATION_ERROR).toBe(-32007);
  });
});

describe('ConduitError', () => {
  it('should create error with message and code', () => {
    const error = new ConduitError('Test error', ErrorCodes.INTERNAL_ERROR);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ConduitError);
    expect(error.message).toBe('Test error');
    expect(error.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(error.name).toBe('ConduitError');
    expect(error.timestamp).toBeInstanceOf(Date);
  });

  it('should create error with context', () => {
    const context = { userId: '123', operation: 'test' };
    const error = new ConduitError('Test error', ErrorCodes.VALIDATION_ERROR, context);

    expect(error.context).toEqual(context);
  });

  it('should serialize to JSON correctly', () => {
    const error = new ConduitError('Test error', ErrorCodes.INTERNAL_ERROR, {
      userId: '123',
    });

    const json = error.toJSON();

    expect(json).toEqual({
      code: ErrorCodes.INTERNAL_ERROR.toString(),
      message: 'Test error',
      details: {
        name: 'ConduitError',
        timestamp: error.timestamp.toISOString(),
        userId: '123',
      },
    });
  });

  it('should maintain stack trace', () => {
    const error = new ConduitError('Test error', ErrorCodes.INTERNAL_ERROR);
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('ConduitError: Test error');
  });
});

describe('isConduitError', () => {
  it('should return true for ConduitError instances', () => {
    const error = new ConduitError('Test', ErrorCodes.INTERNAL_ERROR);
    expect(isConduitError(error)).toBe(true);
  });

  it('should return false for regular Error instances', () => {
    const error = new Error('Test');
    expect(isConduitError(error)).toBe(false);
  });

  it('should return false for non-error values', () => {
    expect(isConduitError('string')).toBe(false);
    expect(isConduitError(123)).toBe(false);
    expect(isConduitError(null)).toBe(false);
    expect(isConduitError(undefined)).toBe(false);
    expect(isConduitError({})).toBe(false);
  });
});

describe('isAbortError', () => {
  it('should return true for DOMException with AbortError name', () => {
    const error = new DOMException('Aborted', 'AbortError');
    expect(isAbortError(error)).toBe(true);
  });

  it('should return true for Error with AbortError name', () => {
    const error = new Error('Operation aborted');
    error.name = 'AbortError';
    expect(isAbortError(error)).toBe(true);
  });

  it('should return true for errors with abort/cancel in message', () => {
    expect(isAbortError(new Error('Operation aborted'))).toBe(true);
    expect(isAbortError(new Error('Request was cancelled'))).toBe(true);
    expect(isAbortError(new Error('CANCELLED BY USER'))).toBe(true);
    expect(isAbortError(new Error('The operation was ABORTED'))).toBe(true);
  });

  it('should return false for non-abort errors', () => {
    expect(isAbortError(new Error('Regular error'))).toBe(false);
    expect(isAbortError(new TypeError('Type error'))).toBe(false);
    expect(isAbortError('not an error')).toBe(false);
    expect(isAbortError(null)).toBe(false);
  });
});

describe('createCancelledError', () => {
  it('should create a ConduitError with CANCELLED code', () => {
    const error = createCancelledError();

    expect(error).toBeInstanceOf(ConduitError);
    expect(error.code).toBe(ErrorCodes.CANCELLED);
    expect(error.message).toBe('Operation cancelled');
  });

  it('should accept context', () => {
    const context = { operation: 'file-scan', path: '/test' };
    const error = createCancelledError(context);

    expect(error.context).toEqual(context);
  });
});

describe('getErrorMessage', () => {
  it('should extract message from Error instances', () => {
    const error = new Error('Test error message');
    expect(getErrorMessage(error)).toBe('Test error message');
  });

  it('should extract message from ConduitError instances', () => {
    const error = new ConduitError('Conduit error message', ErrorCodes.INTERNAL_ERROR);
    expect(getErrorMessage(error)).toBe('Conduit error message');
  });

  it('should return string values as-is', () => {
    expect(getErrorMessage('String error')).toBe('String error');
  });

  it('should extract message from objects with message property', () => {
    const errorLike = { message: 'Object error message', code: 123 };
    expect(getErrorMessage(errorLike)).toBe('Object error message');
  });

  it('should return "Unknown error" for other types', () => {
    expect(getErrorMessage(null)).toBe('Unknown error');
    expect(getErrorMessage(undefined)).toBe('Unknown error');
    expect(getErrorMessage(123)).toBe('Unknown error');
    expect(getErrorMessage({})).toBe('Unknown error');
    expect(getErrorMessage([])).toBe('Unknown error');
  });
});

describe('getErrorCode', () => {
  it('should extract code from ConduitError', () => {
    const error = new ConduitError('Test', ErrorCodes.VALIDATION_ERROR);
    expect(getErrorCode(error)).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('should extract valid code from Error with code property', () => {
    const error = new Error('Test') as Error & { code: number };
    error.code = ErrorCodes.WASM_LOAD_ERROR;
    expect(getErrorCode(error)).toBe(ErrorCodes.WASM_LOAD_ERROR);
  });

  it('should return INTERNAL_ERROR for invalid codes', () => {
    const error = new Error('Test') as Error & { code: number };
    error.code = 99999; // Invalid code
    expect(getErrorCode(error)).toBe(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return INTERNAL_ERROR for non-numeric codes', () => {
    const error = new Error('Test') as Error & { code: string };
    error.code = 'INVALID';
    expect(getErrorCode(error)).toBe(ErrorCodes.INTERNAL_ERROR);
  });

  it('should return INTERNAL_ERROR for non-error values', () => {
    expect(getErrorCode('string')).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(getErrorCode(null)).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(getErrorCode(undefined)).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});

describe('wrapError', () => {
  it('should return ConduitError as-is', () => {
    const originalError = new ConduitError('Original', ErrorCodes.VALIDATION_ERROR);
    const wrapped = wrapError(originalError);

    expect(wrapped).toBe(originalError);
  });

  it('should wrap Error instances with default code', () => {
    const error = new Error('Test error');
    const wrapped = wrapError(error);

    expect(wrapped).toBeInstanceOf(ConduitError);
    expect(wrapped.message).toBe('Test error');
    expect(wrapped.code).toBe(ErrorCodes.INTERNAL_ERROR);
    expect(wrapped.context?.originalError).toBe('Error');
  });

  it('should wrap Error instances with custom code', () => {
    const error = new Error('File not found');
    const wrapped = wrapError(error, ErrorCodes.FILE_ACCESS_ERROR);

    expect(wrapped.code).toBe(ErrorCodes.FILE_ACCESS_ERROR);
  });

  it('should include stack trace in context', () => {
    const error = new Error('Test error');
    const wrapped = wrapError(error);

    expect(wrapped.context?.stack).toBeDefined();
    expect(wrapped.context?.stack).toContain('Error: Test error');
  });

  it('should wrap string errors', () => {
    const wrapped = wrapError('String error message');

    expect(wrapped).toBeInstanceOf(ConduitError);
    expect(wrapped.message).toBe('String error message');
    expect(wrapped.code).toBe(ErrorCodes.INTERNAL_ERROR);
  });

  it('should wrap unknown types', () => {
    const wrapped = wrapError({ custom: 'error' });

    expect(wrapped).toBeInstanceOf(ConduitError);
    expect(wrapped.message).toBe('Unknown error');
  });

  it('should merge provided context', () => {
    const error = new Error('Test');
    const wrapped = wrapError(error, ErrorCodes.VALIDATION_ERROR, {
      field: 'username',
      value: 'test123',
    });

    expect(wrapped.context).toMatchObject({
      originalError: 'Error',
      field: 'username',
      value: 'test123',
    });
  });
});

describe('Error integration scenarios', () => {
  it('should handle abort flow correctly', () => {
    // Simulate abort controller cancellation
    const controller = new AbortController();
    controller.abort();

    const error = new DOMException('The operation was aborted', 'AbortError');

    expect(isAbortError(error)).toBe(true);
    expect(isConduitError(error)).toBe(false);
  });

  it('should handle wrapped abort errors', () => {
    const abortError = new Error('Operation cancelled by user');
    const wrapped = wrapError(abortError, ErrorCodes.CANCELLED);

    expect(wrapped.code).toBe(ErrorCodes.CANCELLED);
    expect(isConduitError(wrapped)).toBe(true);
  });

  it('should handle nested error scenarios', () => {
    const innerError = new Error('Database connection failed');
    const wrappedInner = wrapError(innerError, ErrorCodes.INTERNAL_ERROR, {
      database: 'postgres',
      host: 'localhost',
    });

    // Simulate catching and re-wrapping
    try {
      throw wrappedInner;
    } catch (e) {
      const outerError = wrapError(e, ErrorCodes.TOOL_EXECUTION_ERROR, {
        tool: 'data-processor',
      });

      expect(outerError).toBe(wrappedInner); // Should return as-is since it's already ConduitError
    }
  });
});
