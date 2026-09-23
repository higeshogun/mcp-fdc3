declare module '@mcp-fdc3/client/dist/mcp-fdc3-client.esm.js' {
  import { DesktopAgent } from '@finos/fdc3';
  import { McpResource } from '@mcp-fdc3/client/src/types'; // Using source types if compiled isn't resolving properly
  
  export function isMcpFdc3Resource(mcpResource: any): boolean;
  export function handleMcpFdc3Resource(fdc3Agent: DesktopAgent, mcpResource: any): Promise<void>;
}

declare module '@mcp-fdc3/server/dist/mcp-fdc3-server.esm.js' {
  import { AppIdentifier, Context } from '@finos/fdc3';
  export function createFdc3RaiseIntentResource(intent: string, context: Context, app?: AppIdentifier): any;
  export function createFdc3OpenResource(app: AppIdentifier, context?: Context): any;
  export function createFdc3BroadcastResource(context: Context): any;
}
