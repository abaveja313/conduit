import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { EventEmitter } from 'events';
import { logger } from './logger.js';
import type { TransportState } from './types.js';

/**
 * Base class for WebWorker transports
 * Provides common functionality for both client and server transports
 */
export abstract class BaseWebWorkerTransport extends EventEmitter implements Transport {
  protected state: TransportState = 'disconnected';
  protected messageHandler?: (message: JSONRPCMessage) => void;
  protected enableMessageLogging: boolean;

  constructor(config: { enableMessageLogging?: boolean } = {}) {
    super();
    this.enableMessageLogging = config.enableMessageLogging ?? false;
  }

  /**
   * Get current transport state
   */
  getState(): TransportState {
    return this.state;
  }

  /**
   * Set message handler for incoming messages
   */
  onMessage(handler: (message: JSONRPCMessage) => void): void {
    this.messageHandler = handler;
  }

  /**
   * Handle incoming message with logging and error handling
   */
  protected handleIncomingMessage(event: MessageEvent): void {
    try {
      const message = event.data as JSONRPCMessage;

      if (this.enableMessageLogging) {
        logger.debug('Received message', {
          method: 'method' in message ? message.method : undefined,
          id: 'id' in message ? message.id : undefined,
        });
      }

      if (this.messageHandler) {
        this.messageHandler(message);
      }

      this.emit('message', message);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to handle incoming message', { error: err.message });
      this.emit('error', err);
    }
  }

  /**
   * Log outgoing message
   */
  protected logOutgoingMessage(message: JSONRPCMessage): void {
    if (this.enableMessageLogging) {
      logger.debug('Sending message', {
        method: 'method' in message ? message.method : undefined,
        id: 'id' in message ? message.id : undefined,
      });
    }
  }

  /**
   * Update transport state and emit event
   */
  protected setState(newState: TransportState): void {
    const previousState = this.state;
    this.state = newState;

    logger.debug('Transport state changed', {
      from: previousState,
      to: newState,
    });

    this.emit('state-change', { from: previousState, to: newState });

    if (newState === 'connected') {
      this.emit('connected');
    } else if (newState === 'disconnected') {
      this.emit('disconnected');
    } else if (newState === 'error') {
      this.emit('error');
    }
  }

  abstract start(): Promise<void>;
  abstract close(): Promise<void>;
  abstract send(message: JSONRPCMessage): Promise<void>;
}
