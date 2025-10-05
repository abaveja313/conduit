import { FileService } from '@conduit/fs';
import { streamText, tool, stepCountIs } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';

const SYSTEM_PROMPT = `You are Conduit, an AI-powered file system assistant. You help users navigate, understand, and modify their codebase.

Key capabilities:
- Read files from the STAGED index with line numbers (your working changes, not disk)
- Read PDF and DOCX files (automatically converted to text/HTML, but are READ-ONLY)
- Create / replace entire files in the STAGED index (changes held in memory)
- Mark files for deletion in the STAGED index (NOT deleted from disk)
- List files with pagination (ALWAYS use limit=250 or less)
- View staged modifications and deletions
- Replace specific lines by line number (supports multi-line replacements)
- Delete specific lines by line number
- Insert new content before or after specific lines

Critical concepts:
- STAGED index: Your working area with uncommitted changes (what you read/modify)
- ACTIVE index: The last committed state (what's actually on disk)
- All your changes are STAGED ONLY until the user clicks commit
- deleteFile does NOT delete from disk - it only stages the deletion

Important notes:
- All operations happen locally in browser WebAssembly
- Files must be loaded into WASM before you can access them
- When listing files, ALWAYS use limit=250 or less to avoid overwhelming results
- When reading files: for files under 500 lines, read the entire file at once (e.g., lineRange: {start: 1, end: 500}). For larger files, read in chunks of 200-300 lines. Don't be overly conservative with small 50-line chunks.
- PDF and DOCX files are automatically converted to text/HTML when loaded, but are READ-ONLY (cannot be edited)
- Be concise but thorough in your responses
- Use markdown code blocks with syntax highlighting

Multi-step workflow:
- You can call tools multiple times and reason about their results
- After each tool call, analyze the result and decide what to do next
- Continue using tools until you have fully completed the user's request
- Only provide your final text response when the task is complete

When working with files:
1. Use tools as needed to read, analyze, and modify files
2. All changes are automatically staged (NOT written to disk)
3. Show the user what changed in your final response
4. User must click commit to save changes to disk

Complete the user's request fully before responding with your final answer.`;

export interface ToolCall {
  type: 'tool-use';
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
}

export interface StreamMessage {
  type: 'text' | 'tool-use' | 'tool-result' | 'error' | 'done';
  content?: string;
  toolCall?: ToolCall;
  error?: string;
}

// Convert FileService tools to AI SDK format
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createTools(fileService: FileService): Record<string, any> {
  const fsTools = fileService.getTools();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  // Convert each tool to AI SDK format, excluding beginStaging
  for (const [name, fsTool] of Object.entries(fsTools)) {
    // Skip beginStaging tool - we handle this automatically
    if (name === 'beginStaging') {
      continue;
    }

    tools[name] = tool({
      description: fsTool.description,
      inputSchema: fsTool.parameters, // Use Zod schema directly - AI SDK handles conversion
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: any) => {
        // Always ensure staging is started before any tool call (idempotent)
        await fileService.beginStaging();

        try {
          const result = await fsTool.execute(args);
          return result;
        } catch (error) {
          console.error(`Tool execution error for ${name}:`, error);
          throw error;
        }
      }
    });
  }

  return tools;
}

export async function* streamAnthropicResponse(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  apiKey: string,
  model: string,
  fileService: FileService
): AsyncGenerator<StreamMessage> {
  try {
    // Ensure staging is started at the beginning of each conversation
    await fileService.beginStaging();

    // Create Anthropic client with browser access header
    const anthropic = createAnthropic({
      apiKey,
      headers: { 'anthropic-dangerous-direct-browser-access': 'true' }
    });

    // Create tools from FileService
    const tools = createTools(fileService);

    // Stream text with tools and multi-turn support
    const result = await streamText({
      model: anthropic(model),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages
      ],
      tools,
      toolChoice: 'auto',
      temperature: 0,
      // Enable multi-step tool calling: the model can call tools, reason on results, and continue
      stopWhen: stepCountIs(30), // Allow up to 10 steps for complex tasks

      // Log each step for debugging
      onStepFinish: ({ text, toolCalls, toolResults, finishReason, usage }) => {
        console.log('Step finished:', {
          text: text?.substring(0, 100),
          toolCalls: toolCalls.length,
          toolResults: toolResults.length,
          finishReason,
          usage
        });
      }
    });

    // Stream the response as it comes in
    for await (const chunk of result.fullStream) {
      switch (chunk.type) {
        case 'text-delta':
          yield {
            type: 'text',
            content: chunk.text
          };
          break;

        case 'tool-call':
          yield {
            type: 'tool-use',
            toolCall: {
              type: 'tool-use',
              toolName: chunk.toolName,
              args: ('input' in chunk ? chunk.input : {}) as Record<string, unknown>
            }
          };
          break;

        case 'tool-result':
          yield {
            type: 'tool-result',
            toolCall: {
              type: 'tool-use',
              toolName: chunk.toolName,
              args: ('input' in chunk ? chunk.input : {}) as Record<string, unknown>,
              result: 'output' in chunk ? chunk.output : undefined
            }
          };
          break;

        case 'error': {
          console.error('Stream chunk error:', chunk.error);

          // Handle content filtering errors specifically
          const errorMessage = chunk.error instanceof Error
            ? chunk.error.message
            : typeof chunk.error === 'object' && chunk.error !== null && 'message' in chunk.error
              ? (chunk.error as { message: string }).message
              : String(chunk.error);

          yield {
            type: 'error',
            error: errorMessage
          };
          break;
        }

        case 'finish':
          // Stream completed
          break;
      }
    }

    yield { type: 'done' };
  } catch (error) {
    console.error('Error in Anthropic stream:', error);
    yield {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}