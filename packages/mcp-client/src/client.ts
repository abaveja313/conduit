import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { WebWorkerClientTransport } from "@mcp-b/transports";
import { Tool, CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Logger } from "@conduit/shared";
import { EventEmitter } from "events";
import {
    WorkerClientConfig,
    WorkerClientMetrics,
    ConnectionState,
    WorkerClientEvents,
    ToolCallOptions
} from "./types.js";

/**
 * Conduit-specific wrapper around WebWorkerClientTransport
 * Adds logging, metrics, and error handling
 */
export class ConduitWorkerClientTransport extends WebWorkerClientTransport {
    private logger: Logger;
    private metrics: WorkerClientMetrics;

    constructor(worker: Worker, logger: Logger) {
        super(worker);
        this.logger = logger;
        this.metrics = {
            connectionAttempts: 0,
            successfulConnections: 0,
            failedConnections: 0,
            toolCalls: new Map(),
            workerRestarts: 0
        };
    }

    async send(message: any) {
        this.logger.debug('Sending message to worker', {
            method: message.method,
            id: message.id
        });

        try {
            return await super.send(message);
        } catch (error) {
            this.logger.error('Failed to send message to worker', {
                error: error instanceof Error ? error.message : error,
                message
            });
            throw error;
        }
    }

    getMetrics(): WorkerClientMetrics {
        return { ...this.metrics };
    }

    incrementConnectionAttempt() {
        this.metrics.connectionAttempts++;
    }

    recordConnectionSuccess() {
        this.metrics.successfulConnections++;
        this.metrics.lastConnectionTime = Date.now();
    }

    recordConnectionFailure() {
        this.metrics.failedConnections++;
    }
}

/**
 * Main Conduit Worker Client
 * Manages connection to worker server and provides high-level API
 */
export class ConduitWorkerClient extends EventEmitter {
    private mcpClient: Client;
    private transport: ConduitWorkerClientTransport | null = null;
    private worker: Worker | null = null;
    private logger: Logger;
    private config: WorkerClientConfig;
    private connectionState: ConnectionState = 'disconnected';
    private availableTools: Tool[] = [];
    private reconnectTimer: NodeJS.Timeout | null = null;

    constructor(config: WorkerClientConfig) {
        super();
        this.config = config;
        this.logger = config.logger || console as any; // Fallback logger

        // Initialize MCP client
        this.mcpClient = new Client({
            name: config.name,
            version: config.version
        });

        this.setupEventHandlers();
    }

    private setupEventHandlers() {
        // Set up periodic metrics collection
        if (this.config.enableMetrics) {
            setInterval(() => {
                if (this.transport) {
                    this.emit('metrics:update', {
                        metrics: this.transport.getMetrics()
                    });
                }
            }, 5000); // Every 5 seconds
        }
    }

    private setState(newState: ConnectionState) {
        const previousState = this.connectionState;
        this.connectionState = newState;

        this.emit('connection:state', {
            state: newState,
            previousState
        });

        this.logger.info('Connection state changed', {
            from: previousState,
            to: newState
        });
    }

    private createWorker(): Worker {
        this.logger.debug('Creating worker', {
            scriptPath: this.config.workerScriptPath
        });

        const worker = new Worker(this.config.workerScriptPath, {
            type: 'module'
        });

        worker.onerror = (error) => {
            this.logger.error('Worker error', { error });
            this.handleWorkerError(new Error(`Worker error: ${error.message}`));
        };

        worker.onmessageerror = (error) => {
            this.logger.error('Worker message error', { error });
            this.handleWorkerError(new Error('Worker message error'));
        };

        this.emit('worker:created', {
            workerScriptPath: this.config.workerScriptPath
        });

        return worker;
    }

    private handleWorkerError(error: Error) {
        this.logger.error('Worker error occurred', { error });

        if (this.connectionState === 'connected') {
            this.setState('reconnecting');
            this.scheduleReconnect();
        } else {
            this.setState('failed');
        }
    }

    private scheduleReconnect() {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        const delay = this.config.reconnectDelay || 1000;

        this.reconnectTimer = setTimeout(() => {
            this.connect();
        }, delay);
    }

    /**
     * Connect to the worker server
     */
    async connect(): Promise<void> {
        if (this.connectionState === 'connected') {
            this.logger.warn('Already connected');
            return;
        }

        this.setState('connecting');

        try {
            // Create worker
            this.worker = this.createWorker();

            // Create transport
            this.transport = new ConduitWorkerClientTransport(
                this.worker,
                this.logger
            );

            this.transport.incrementConnectionAttempt();

            // Connect MCP client
            await this.mcpClient.connect(this.transport);

            // Load available tools
            await this.loadAvailableTools();

            this.transport.recordConnectionSuccess();
            this.setState('connected');

            this.logger.info('Connected to worker server', {
                toolCount: this.availableTools.length
            });

        } catch (error) {
            this.transport?.recordConnectionFailure();

            this.logger.error('Failed to connect to worker', { error });

            this.emit('connection:error', {
                error: error instanceof Error ? error : new Error(String(error)),
                attempt: this.transport?.getMetrics().connectionAttempts || 0
            });

            this.setState('failed');
            throw error;
        }
    }

    private async loadAvailableTools(): Promise<void> {
        try {
            const response = await this.mcpClient.listTools();
            this.availableTools = response.tools;

            this.logger.debug('Loaded available tools', {
                tools: this.availableTools.map(t => t.name)
            });
        } catch (error) {
            this.logger.error('Failed to load available tools', { error });
            throw error;
        }
    }

    /**
     * Disconnect from worker server
     */
    async disconnect(): Promise<void> {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.worker) {
            this.worker.terminate();
            this.emit('worker:terminated', { reason: 'disconnect' });
            this.worker = null;
        }

        if (this.transport) {
            await this.mcpClient.close();
            this.transport = null;
        }

        this.setState('disconnected');
        this.logger.info('Disconnected from worker server');
    }

    /**
     * Get list of available tools
     */
    getAvailableTools(): Tool[] {
        return [...this.availableTools];
    }

    /**
     * Call a tool on the worker server
     */
    async callTool(
        name: string,
        params: unknown = {},
        options: ToolCallOptions = {}
    ): Promise<CallToolResult> {
        if (this.connectionState !== 'connected') {
            throw new Error(`Cannot call tool: connection state is ${this.connectionState}`);
        }

        if (!this.transport) {
            throw new Error('Transport not available');
        }

        const startTime = performance.now();
        const timeout = options.timeout || this.config.toolTimeout || 30000;

        this.emit('tool:call', { toolName: name, params, startTime });

        try {
            // Create timeout promise
            const timeoutPromise = new Promise<never>((_, reject) => {
                setTimeout(() => {
                    this.emit('tool:timeout', { toolName: name, timeout });
                    reject(new Error(`Tool call timeout: ${name}`));
                }, timeout);
            });

            // Race between tool call and timeout
            const result = await Promise.race([
                this.mcpClient.callTool({ name, arguments: params }),
                timeoutPromise
            ]);

            const duration = performance.now() - startTime;

            // Update metrics
            this.updateToolMetrics(name, duration, true);

            this.emit('tool:result', {
                toolName: name,
                duration,
                success: true
            });

            return result;

        } catch (error) {
            const duration = performance.now() - startTime;

            // Update metrics
            this.updateToolMetrics(name, duration, false);

            this.logger.error('Tool call failed', {
                toolName: name,
                params,
                error
            });

            throw error;
        }
    }

    private updateToolMetrics(toolName: string, duration: number, success: boolean) {
        if (!this.transport) return;

        const metrics = this.transport.getMetrics();
        const existing = metrics.toolCalls.get(toolName) || {
            count: 0,
            totalTime: 0,
            averageTime: 0,
            errors: 0,
            timeouts: 0
        };

        existing.count++;
        existing.totalTime += duration;
        existing.averageTime = existing.totalTime / existing.count;

        if (!success) {
            existing.errors++;
        }

        metrics.toolCalls.set(toolName, existing);
    }

    /**
     * Get current connection state
     */
    getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    /**
     * Get client metrics
     */
    getMetrics(): WorkerClientMetrics | null {
        return this.transport?.getMetrics() || null;
    }

    /**
     * Check if a specific tool is available
     */
    hasToolAvailable(toolName: string): boolean {
        return this.availableTools.some(tool => tool.name === toolName);
    }
}
