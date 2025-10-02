import { FileService } from '@conduit/fs';

const SYSTEM_PROMPT = `You are Conduit, an AI-powered file system assistant. You help users navigate, understand, and modify their codebase.

Key capabilities:
- Read files and specific line ranges from the loaded WASM index
- Create or update files (changes are staged for review)
- Delete files (permanent operation)
- View all staged modifications

Important notes:
- All file operations happen locally in the browser using WebAssembly
- Files must be loaded into WASM memory before you can read them
- Be concise but thorough in your responses
- When showing code, use markdown code blocks with appropriate syntax highlighting

When working with files:
1. Make your modifications (they are automatically staged)
2. Show the user what changed
3. Let them decide to commit or revert`;

// Convert FileService tools to Anthropic format
function convertToolsForAnthropic(fileService: FileService) {
  const tools = fileService.getTools();

  return Object.entries(tools)
    .filter(([name]) => name !== 'beginStaging') // Exclude beginStaging
    .map(([name, tool]) => ({
      name,
      description: tool.description,
      input_schema: tool.parameters
    }));
}

interface AnthropicToolCall {
  name: string;
  input: Record<string, unknown>;
}

// Execute tool call for Anthropic
export async function executeToolCall(
  toolCall: AnthropicToolCall,
  fileService: FileService
) {
  // Always ensure staging is started before any tool call (idempotent)
  await fileService.beginStaging();

  const tools = fileService.getTools();
  const toolName = toolCall.name;
  const toolArgs = toolCall.input;

  const tool = tools[toolName as keyof typeof tools];
  if (!tool) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  try {
    // The tool's execute method will validate the parameters using its schema
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await tool.execute(toolArgs as any);
    return result;
  } catch (error) {
    console.error('Tool execution error:', error);
    return { error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

// Anthropic API client
export async function callAI(
  messages: Array<{ role: string; content: string }>,
  apiKey: string,
  model: string,
  fileService: FileService
) {
  const tools = convertToolsForAnthropic(fileService);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      messages,
      system: SYSTEM_PROMPT,
      tools,
      stream: true
    })
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
  }

  return response;
}