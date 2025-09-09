import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { BaseWebWorkerTransport } from './webworker.js';
import { logger } from './logger.js';

/**
 * WebWorker client transport - runs in main thread
 * Handles communication from main thread to worker
 */
export class WebWorkerClientTransport extends BaseWebWorkerTransport {
  private worker: Worker;

  constructor(worker: Worker, config: { enableMessageLogging?: boolean } = {}) {
    super(config);
    this.worker = worker;
  }

  async start(): Promise<void> {
    if (this.state !== 'disconnected') {
      logger.warn('Transport already started or starting');
      return;
    }

    this.setState('connecting');

    try {
      // Set up message listener for worker messages
      this.worker.addEventListener('message', this.handleMessage);

      // Set up error handling
      this.worker.addEventListener('error', this.handleWorkerError);
      this.worker.addEventListener('messageerror', this.handleMessageError);

      this.setState('connected');
      logger.info('WebWorker client transport started');
    } catch (error) {
      this.setState('error');
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to start client transport', { error: err.message });
      throw err;
    }
  }

  async close(): Promise<void> {
    if (this.state === 'disconnected') {
      return;
    }

    this.setState('disconnecting');

    try {
      // Remove all event listeners
      this.worker.removeEventListener('message', this.handleMessage);
      this.worker.removeEventListener('error', this.handleWorkerError);
      this.worker.removeEventListener('messageerror', this.handleMessageError);

      // Terminate the worker
      this.worker.terminate();

      this.setState('disconnected');
      logger.info('WebWorker client transport closed');
    } catch (error) {
      this.setState('error');
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to close client transport', { error: err.message });
      throw err;
    }
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (this.state !== 'connected') {
      throw new Error(`Cannot send message: transport state is ${this.state}`);
    }

    try {
      this.logOutgoingMessage(message);

      // Send message to worker
      this.worker.postMessage(message);
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
   * Handle incoming message from worker
   */
  private handleMessage = (event: MessageEvent): void => {
    this.handleIncomingMessage(event);
  };

  /**
   * Handle worker errors
   */
  private handleWorkerError = (event: ErrorEvent): void => {
    const error = new Error(`Worker error: ${event.message}`);
    logger.error('Worker error occurred', {
      error: error.message,
      filename: event.filename,
      lineno: event.lineno,
      colno: event.colno,
    });

    this.setState('error');
    this.emit('error', error);
  };

  /**
   * Handle message serialization errors
   */
  private handleMessageError = (): void => {
    const error = new Error('Worker message error: Failed to deserialize message');
    logger.error('Message error occurred', { error: error.message });

    this.emit('error', error);
  };

  /**
   * Get the underlying worker instance
   */
  getWorker(): Worker {
    return this.worker;
  }
}
