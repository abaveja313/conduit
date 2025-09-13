import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { BaseWebWorkerTransport } from './webworker.js';
import { logger } from './logger.js';

/**
 * WebWorker server transport - runs inside the worker
 * Handles communication from worker to main thread
 */
export class WebWorkerServerTransport extends BaseWebWorkerTransport {
  constructor(config: { enableMessageLogging?: boolean } = {}) {
    super(config);
  }

  async start(): Promise<void> {
    if (this.state !== 'disconnected') {
      logger.warn('Transport already started or starting');
      return;
    }

    this.setState('connecting');

    try {
      self.addEventListener('message', this.handleMessage);

      this.setState('connected');
      logger.info('WebWorker server transport started');
    } catch (error) {
      this.setState('error');
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to start server transport', { error: err.message });
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this.state === 'disconnected') {
      return;
    }

    this.setState('disconnecting');

    try {
      self.removeEventListener('message', this.handleMessage);

      this.setState('disconnected');
      logger.info('WebWorker server transport closed');
    } catch (error) {
      this.setState('error');
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to close server transport', { error: err.message });
      throw err;
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.state !== 'connected') {
      throw new Error(`Cannot send message: transport state is ${this.state}`);
    }

    try {
      this.logOutgoingMessage(message);

      // Send message to main thread
      self.postMessage(message);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to send message', {
        error: err.message,
        messageId: 'id' in message ? message.id : undefined,
      });
      throw err;
    }
  }

  /**
   * Handle incoming message from main thread
   */
  private handleMessage = (event: MessageEvent): void => {
    this.handleIncomingMessage(event);
  };
}
