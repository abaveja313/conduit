import { describe, it, expect } from 'vitest';
import echoTool from '../tools/echo.tool';

describe('Echo Tool', () => {
  it('should echo message once by default', async () => {
    const result = await echoTool.handler(
      { message: 'Hello', repeat: 1 },
      { wasm: {}, signal: undefined },
    );

    expect(result).toEqual({
      echoed: 'Hello',
      count: 1,
    });
  });

  it('should repeat message multiple times', async () => {
    const result = await echoTool.handler(
      { message: 'Hi', repeat: 3 },
      { wasm: {}, signal: undefined },
    );

    expect(result).toEqual({
      echoed: 'Hi Hi Hi',
      count: 3,
    });
  });

  it('should handle cancellation', async () => {
    const abortController = new AbortController();
    abortController.abort();

    await expect(
      echoTool.handler(
        { message: 'Test', repeat: 1 },
        { wasm: {}, signal: abortController.signal },
      ),
    ).rejects.toThrow('Operation cancelled');
  });

  it('should report progress when provided', async () => {
    interface ProgressCall {
      current: number;
      total?: number;
      message?: string;
    }
    const progressCalls: ProgressCall[] = [];
    const progress = (current: number, total?: number, message?: string) => {
      progressCalls.push({ current, total, message });
    };

    await echoTool.handler({ message: 'Test', repeat: 2 }, { wasm: {}, progress });

    expect(progressCalls).toEqual([
      { current: 1, total: 2, message: 'Echoing 1/2' },
      { current: 2, total: 2, message: 'Echoing 2/2' },
    ]);
  });
});
