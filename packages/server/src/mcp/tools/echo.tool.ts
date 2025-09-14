import { z } from 'zod';
import type { ToolDefinition } from '../types';

const inputSchema = z.object({
    message: z.string().describe('Message to echo'),
    repeat: z.number().min(1).max(10).default(1).describe('Number of times to repeat')
});

const echoTool: ToolDefinition = {
    name: 'echo',
    description: 'Simple echo tool for testing',
    inputSchema,

    capabilities: {
        progressive: true
    },

    handler: async (params, context) => {
        if (context.signal?.aborted) {
            throw new Error('Operation cancelled');
        }

        const results: string[] = [];
        for (let i = 0; i < params.repeat; i++) {
            context.progress?.(i + 1, params.repeat, `Echoing ${i + 1}/${params.repeat}`);
            results.push(params.message);

            if (context.signal?.aborted) {
                throw new Error('Operation cancelled');
            }
        }

        return {
            echoed: results.join(' '),
            count: params.repeat
        };
    }
};

export default echoTool;
