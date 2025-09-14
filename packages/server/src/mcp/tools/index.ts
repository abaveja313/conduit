import echoTool from './echo.tool';

export const tools = [
  echoTool,
  // Add other tools here as they are created
].sort((a, b) => a.name.localeCompare(b.name));

export type ToolName = (typeof tools)[number]['name'];
