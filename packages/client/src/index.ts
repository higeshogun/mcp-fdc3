import { DesktopAgent } from '@finos/fdc3';
import { getFdc3StrategyExecutor } from './executors/fdc3StrategyExecutors';
import { Fdc3ApiMimeType, Fdc3ApiUri, GenericFdc3ActionRequest, McpResource } from './types';

export function isMcpFdc3Resource(mcpResource: any): boolean {
  if (!mcpResource) return false;
  if (mcpResource.uri === Fdc3ApiUri && mcpResource.mimeType === Fdc3ApiMimeType && !!mcpResource.text) {
    return true;
  }
  if (mcpResource.resource && isMcpFdc3Resource(mcpResource.resource)) {
    return true;
  }
  return false;
}

export async function handleMcpFdc3Resource(fdc3Agent: DesktopAgent, mcpResource: any): Promise<void> {
  const actual: McpResource = (mcpResource && mcpResource.resource && isMcpFdc3Resource(mcpResource.resource))
    ? mcpResource.resource
    : mcpResource;

  if (!actual || !isMcpFdc3Resource(actual)) {
    console.warn('[MCP-FDC3] Warning: Invalid or non-FDC3 resource passed to handleMcpFdc3Resource:', mcpResource);
    return;
  }

  console.log('%c[MCP-FDC3] handleMcpFdc3Resource executing', 'color:#38bdf8;font-weight:bold;', {
    uri: actual.uri,
    mimeType: actual.mimeType,
  });

  let fdc3Message: GenericFdc3ActionRequest | null = null;
  try {
    fdc3Message = JSON.parse(actual.text) as GenericFdc3ActionRequest;
  } catch (e) {
    console.error('[MCP-FDC3] Failure parsing FDC3 resource text:', e, actual.text);
  }
  if (fdc3Message) {
    const fdc3StrategyExecutor = getFdc3StrategyExecutor(fdc3Message.type);
    await fdc3StrategyExecutor(fdc3Agent, fdc3Message);
  }
}
