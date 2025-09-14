import type { ToolDefinition } from '../types';
import echoTool from './echo.tool';

export const tools: ToolDefinition[] = [
    echoTool,
    // Add other tools here as they are created
].sort((a, b) => a.name.localeCompare(b.name));

export type ToolName = typeof tools[number]['name'];
