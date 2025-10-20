import { FileService } from '@conduit/fs';
import { streamText, tool, stepCountIs } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { trackToolInvoked, startToolTimer, endToolTimer } from './posthog';
import { createLogger } from '@conduit/shared';

const logger = createLogger('web:anthropic-client');

const SYSTEM_PROMPT = `You are Conduit, an AI-powered file system assistant. You help users navigate, understand, and modify their codebase.

ALWAYS call readFile() BEFORE using replaceLines, deleteLines, or insertLines.
- Line numbers change after EVERY edit - old line numbers become INVALID
- If you don't read the file first, you WILL edit the wrong lines
- This applies EVERY SINGLE TIME you want to edit by line number
- Correct workflow: readFile() → identify current line numbers → then edit
- Do this after before EVERY edit, not just the first time

Key capabilities:
- Read files from the STAGED index with line numbers (your working changes, not disk)
- Read PDF and DOCX files (automatically converted to text/HTML, but are READ-ONLY)
- Create / replace entire files in the STAGED index (changes held in memory)
- Mark files for deletion in the STAGED index (NOT deleted from disk)
- Copy files to new locations in the STAGED index
- Move/rename files efficiently in the STAGED index (tracked properly in diffs)
- List files with pagination (ALWAYS use limit=250 or less)
- Search files using regex patterns with context
- View staged modifications and deletions
- Replace specific lines by line number (MUST read file first!)
- Delete specific lines by line number (MUST read file first!)
- Insert new content before or after specific lines (MUST read file first!)

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
2. ALL line-based edits require reading the file first to get current line numbers
3. All changes are automatically staged (NOT written to disk)
4. Show the user what changed in your final response
5. User must click commit to save changes to disk

⚠️ REMINDER: Before replaceLines/deleteLines/insertLines, ALWAYS call readFile() first!

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

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function getToolOperation(toolName: string, args: unknown): string | undefined {
  switch (toolName) {
    case 'readFile':
      return 'read';
    case 'createFile':
      return 'create';
    case 'deleteFile':
      return 'delete';
    case 'replaceLines':
    case 'deleteLines':
    case 'insertLines':
      return 'modify';
    case 'listFiles':
      return 'list';
    case 'searchFiles':
      return 'search';
    case 'getStagedModifications':
    case 'getStagedModificationsWithDiff':
      return 'view_staged';
    case 'commitChanges':
      return 'commit';
    case 'revertChanges':
      return 'revert';
    case 'copyFile':
      return 'copy';
    case 'moveFile':
      return 'move';
    default:
      return undefined;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getLinesAffected(toolName: string, args: any, result: any): number | undefined {
  switch (toolName) {
    case 'replaceLines':
      return args.lineNumbers?.length || 0;
    case 'deleteLines':
      return args.lineNumbers?.length || 0;
    case 'insertLines':
      return (args.content?.match(/\n/g) || []).length + 1;
    case 'readFile':
      return result?.lines?.length || 0;
    default:
      return undefined;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function createTools(fileService: FileService): Record<string, any> {
  const fsTools = fileService.getTools();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tools: Record<string, any> = {};

  for (const [name, fsTool] of Object.entries(fsTools)) {
    if (name === 'beginStaging') {
      continue;
    }

    tools[name] = tool({
      description: fsTool.description,
      inputSchema: fsTool.parameters,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (args: any) => {
        await fileService.beginStaging();

        startToolTimer(name);

        try {
          const result = await fsTool.execute(args);
          const duration = endToolTimer(name);

          trackToolInvoked({
            toolName: name,
            operation: getToolOperation(name, args),
            path: args.path || args.filePath,
            linesAffected: getLinesAffected(name, args, result),
            fileSize: args.size,
            isDocument: args.path?.endsWith('.pdf') || args.path?.endsWith('.docx'),
            duration,
            success: true,
          });

          return result;
        } catch (error) {
          const duration = endToolTimer(name);
          logger.error(`Tool execution error for ${name}:`, error);

          trackToolInvoked({
            toolName: name,
            operation: getToolOperation(name, args),
            path: args.path || args.filePath,
            duration,
            success: false,
            errorType: error instanceof Error ? error.message : 'Unknown error',
          });

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
    await fileService.beginStaging();

    // Always use proxy for security - never expose API keys in browser
    const anthropic = createAnthropic({
      apiKey: 'proxy-placeholder', // Placeholder - actual auth happens via proxy
      fetch: async (url, options) => {
        const anthropicUrl = new URL(url.toString());

        const headers = new Headers(options?.headers);
        headers.set('x-anthropic-path', anthropicUrl.pathname);

        // Only include user API key if explicitly provided
        if (apiKey && apiKey.trim()) {
          headers.set('x-api-key', apiKey);
          logger.debug('Using user-provided API key');
        } else {
          // For trial users, send placeholder that proxy will replace with server-side key
          headers.set('x-api-key', 'proxy-placeholder');
          logger.debug('Using trial mode (placeholder key)');
        }

        const sharedSecret = process.env.NEXT_PUBLIC_SHARED_SECRET;
        if (sharedSecret) {
          headers.set('x-shared-secret', sharedSecret);
        }

        return fetch('/api/anthropic', {
          ...options,
          headers,
        });
      }
    });

    const tools = createTools(fileService);

    const result = await streamText({
      model: anthropic(model),
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        ...messages
      ],
      tools,
      toolChoice: 'auto',
      temperature: 0,
      stopWhen: stepCountIs(100),

      onStepFinish: ({ text, toolCalls, toolResults, finishReason, usage }) => {
        logger.debug('Step finished:', {
          text: text?.substring(0, 100),
          toolCalls: toolCalls.length,
          toolResults: toolResults.length,
          finishReason,
          usage
        });
      }
    });

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
          logger.error('Stream chunk error:', chunk.error);

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
          break;
      }
    }

    yield { type: 'done' };
  } catch (error) {
    logger.error('Error in Anthropic stream:', error);
    yield {
      type: 'error',
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}