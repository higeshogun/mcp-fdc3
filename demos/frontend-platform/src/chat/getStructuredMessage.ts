import type { StructuredMessage } from './types';

export function getStructuredMessage(messages: any[]): StructuredMessage {
  // Extract resource artifact and final natural language answer from LangChain serialized messages
  const result: StructuredMessage = {
    toolCalls: [],
  };

  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgType = msg?.id?.[2];

    if (msgType === 'ToolMessage') {
      const artifacts = msg?.kwargs?.artifact;
      if (Array.isArray(artifacts)) {
        for (const art of artifacts) {
          if (art?.type === 'resource' && art.resource && !result.mcpResource) {
            result.mcpResource = art.resource;
            break;
          }
        }
      }
    }

    if (msgType === 'AIMessage') {
      // Capture tool calls if present
      const toolCalls = msg?.kwargs?.tool_calls;
      if (Array.isArray(toolCalls) && toolCalls.length > 0) {
        result.toolCalls = [...(result.toolCalls || []), ...toolCalls];
      }

      // Capture text content
      const content = msg?.kwargs?.content;
      if (typeof content === 'string' && content.trim() && !result.textContent) {
        result.textContent = content.trim();
      } else if (Array.isArray(content) && !result.textContent) {
        const text = content
          .map((p: any) => (typeof p === 'string' ? p : p?.text ?? ''))
          .filter(Boolean)
          .join('\n')
          .trim();
        if (text) result.textContent = text;
      }
    }

    if (msgType === 'HumanMessage' && (result.mcpResource || result.textContent || (result.toolCalls && result.toolCalls.length > 0))) {
      break;
    }
  }

  // Set finalAnswer to textContent for display
  result.finalAnswer = result.textContent;

  return result;
}
