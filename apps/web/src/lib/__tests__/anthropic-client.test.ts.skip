import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { FileService } from '@conduit/fs';

vi.mock('ai', () => ({
    streamText: vi.fn(),
    tool: vi.fn((config) => config),
    stepCountIs: vi.fn((count) => ({ _tag: 'step-count', count })),
}));

vi.mock('@ai-sdk/anthropic', () => ({
    createAnthropic: vi.fn(),
}));

import { streamAnthropicResponse } from '../anthropic-client';
import { streamText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

describe('Anthropic client API key handling', () => {
    let capturedFetchConfig: {
        apiKey?: string;
        fetch?: (url: string, options?: RequestInit) => Promise<Response>;
    } | null = null;
    let mockFileService: Partial<FileService>;
    const mockStreamText = streamText as ReturnType<typeof vi.fn>;
    const mockCreateAnthropic = createAnthropic as ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        capturedFetchConfig = null;

        mockCreateAnthropic.mockImplementation(
            (config: {
                apiKey?: string;
                fetch?: (url: string, options?: RequestInit) => Promise<Response>;
            }) => {
                capturedFetchConfig = config;
                return vi.fn();
            },
        );

        mockStreamText.mockImplementation(async () => {
            if (capturedFetchConfig?.fetch) {
                await capturedFetchConfig.fetch('https://api.anthropic.com/v1/messages', {
                    method: 'POST',
                    headers: new Headers(),
                    body: JSON.stringify({}),
                });
            }

            return {
                textStream: (async function* () {
                    yield 'test response';
                })(),
                toolCalls: [],
                toolResults: [],
            };
        });

        mockFileService = {
            beginStaging: vi.fn().mockResolvedValue(undefined),
            commitChanges: vi.fn().mockResolvedValue({ modified: 0, deleted: 0 }),
            getFiles: vi.fn().mockReturnValue([]),
            readFile: vi.fn().mockResolvedValue('content'),
            writeFile: vi.fn().mockResolvedValue(undefined),
            getTools: vi.fn().mockReturnValue({
                read_files: { description: 'Read files' },
                write_files: { description: 'Write files' },
                move_file: { description: 'Move file' },
                create_file: { description: 'Create file' },
                list_files: { description: 'List files' },
                run_command: { description: 'Run command' },
                run_script: { description: 'Run script' },
                search: { description: 'Search' },
                git_diff: { description: 'Git diff' },
                commit_changes: { description: 'Commit changes' },
            }),
        };

        global.fetch = vi.fn().mockResolvedValue({
            ok: true,
            status: 200,
            headers: new Headers(),
            text: () => Promise.resolve('{"success":true}'),
            json: () => Promise.resolve({ success: true }),
        });
    });

    describe('API key placeholder logic', () => {
        it('should send proxy-placeholder when no API key provided (trial mode)', async () => {
            const messages = [{ role: 'user' as const, content: 'test' }];

            const stream = streamAnthropicResponse(
                messages,
                '',
                'claude-sonnet-4-5-20250929',
                mockFileService as FileService,
            );

            for await (const event of stream) {
                void event;
                break;
            }

            expect(capturedFetchConfig).toBeDefined();
            expect(capturedFetchConfig.apiKey).toBe('proxy-placeholder');

            expect(global.fetch).toHaveBeenCalledWith(
                '/api/anthropic',
                expect.objectContaining({
                    headers: expect.any(Headers),
                }),
            );

            const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
            const headers = fetchCall[1].headers;
            expect(headers.get('x-api-key')).toBe('proxy-placeholder');
            expect(headers.get('x-anthropic-path')).toBe('/v1/messages');
        });

        it('should send proxy-placeholder when API key is whitespace only', async () => {
            const messages = [{ role: 'user' as const, content: 'test' }];

            const stream = streamAnthropicResponse(
                messages,
                '   ',
                'claude-sonnet-4-5-20250929',
                mockFileService as FileService,
            );

            for await (const event of stream) {
                void event;
                break;
            }

            const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
            const headers = fetchCall[1].headers;

            expect(headers.get('x-api-key')).toBe('proxy-placeholder');
        });

        it('should pass through user API key when provided', async () => {
            const messages = [{ role: 'user' as const, content: 'test' }];
            const userApiKey = 'sk-ant-api03-user-key-123';

            const stream = streamAnthropicResponse(
                messages,
                userApiKey,
                'claude-sonnet-4-5-20250929',
                mockFileService as FileService,
            );

            for await (const event of stream) {
                void event;
                break;
            }

            const fetchCall = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
            const headers = fetchCall[1].headers;

            expect(headers.get('x-api-key')).toBe(userApiKey);
        });

        it('should always call the proxy endpoint /api/anthropic', async () => {
            const messages = [{ role: 'user' as const, content: 'test' }];

            const stream = streamAnthropicResponse(
                messages,
                '',
                'claude-sonnet-4-5-20250929',
                mockFileService as FileService,
            );

            for await (const event of stream) {
                void event;
                break;
            }

            expect(global.fetch).toHaveBeenCalledWith('/api/anthropic', expect.any(Object));
        });

        it('should handle different model selections', async () => {
            const messages = [{ role: 'user' as const, content: 'test' }];
            const models = [
                'claude-haiku-4-5-20251001',
                'claude-sonnet-4-5-20250929',
                'claude-opus-4-1-20250805',
            ];

            for (const model of models) {
                vi.clearAllMocks();

                const stream = streamAnthropicResponse(
                    messages,
                    'sk-ant-test',
                    model,
                    mockFileService as FileService,
                );

                for await (const event of stream) {
                    void event;
                    break;
                }

                expect(mockStreamText).toHaveBeenCalled();
            }
        });
    });

    describe('Error handling', () => {
        it('should handle errors gracefully', async () => {
            const messages = [{ role: 'user' as const, content: 'test' }];

            mockStreamText.mockRejectedValueOnce(new Error('API error'));

            const stream = streamAnthropicResponse(
                messages,
                '',
                'claude-sonnet-4-5-20250929',
                mockFileService as FileService,
            );

            const events = [];
            for await (const event of stream) {
                events.push(event);
            }

            // Should yield an error event
            const errorEvent = events.find((e) => e.type === 'error');
            expect(errorEvent).toBeDefined();
            expect(errorEvent?.error).toContain('API error');
        });
    });
});
