import { NextRequest, NextResponse } from 'next/server';
import { createLogger } from '@conduit/shared';

const logger = createLogger('web:api:anthropic');

// Using nodejs runtime for better compatibility with streaming responses
export const maxDuration = 300; // 5 minutes for long conversations

export async function POST(request: NextRequest) {
    try {
        const body = await request.text();
        const headers = Object.fromEntries(request.headers.entries());

        // Validate shared secret to prevent automated attacks
        const clientSecret = headers['x-shared-secret'];
        const serverSecret = process.env.SHARED_SECRET;

        if (serverSecret && clientSecret !== serverSecret) {
            logger.error('Invalid shared secret');
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 403 }
            );
        }

        const anthropicPath = headers['x-anthropic-path'] || '/v1/messages';

        // Handle API key - check if it's a placeholder or real user key
        const userApiKey = headers['x-api-key'];
        const internalApiKey = process.env.ANTHROPIC_API_KEY;

        // If the client sends "proxy-placeholder", use internal key
        // Otherwise use the provided key if valid, or fall back to internal
        const isPlaceholder = userApiKey === 'proxy-placeholder';
        const isValidUserKey = userApiKey && userApiKey !== 'proxy-placeholder' && userApiKey.trim();

        const apiKey = isValidUserKey ? userApiKey : internalApiKey;
        const usingUserKey = isValidUserKey;

        if (!apiKey) {
            logger.error('No API key found (neither user-provided nor internal)');
            return NextResponse.json(
                { error: 'No API key available' },
                { status: 401 }
            );
        }

        const anthropicUrl = `https://api.anthropic.com${anthropicPath}`;

        logger.debug('Proxying request to Anthropic', {
            path: anthropicPath,
            bodyLength: body.length,
            isPlaceholder,
            usingUserKey
        });

        const response = await fetch(anthropicUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'anthropic-version': headers['anthropic-version'] || '2023-06-01',
                'x-api-key': apiKey,
            },
            body: body,
        });

        if (!response.ok) {
            const errorText = await response.text();
            logger.error('Anthropic API error', {
                status: response.status,
                error: errorText
            });
            return new NextResponse(errorText, {
                status: response.status,
                headers: { 'Content-Type': 'application/json' },
            });
        }

        return new NextResponse(response.body, {
            status: response.status,
            statusText: response.statusText,
            headers: {
                'Content-Type': response.headers.get('Content-Type') || 'text/event-stream',
                'Cache-Control': 'no-cache, no-transform',
                'X-Accel-Buffering': 'no', // Disable nginx buffering
            },
        });
    } catch (error) {
        logger.error('Proxy error:', error);
        return NextResponse.json(
            { error: 'Failed to proxy request', details: error instanceof Error ? error.message : 'Unknown error' },
            { status: 500 }
        );
    }
}
