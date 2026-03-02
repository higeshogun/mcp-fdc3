import type { StructuredMessage } from './types';

export function getStructuredMessage(messages: any[]): StructuredMessage {
  // Extract resource artifact and final natural language answer from LangChain serialized messages
  const result: StructuredMessage = {};
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
    if (result.mcpResource || msgType === 'HumanMessage') {
      break; // Found the current turn's resource, or hit the start of the current turn
    }
  }
  // Find last AIMessage with text content
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const msgType = msg?.id?.[2];
    if (msgType === 'AIMessage') {
      const content = msg?.kwargs?.content;
      if (typeof content === 'string') {
        result.finalAnswer = content.trim();
        break;
      }
      if (Array.isArray(content)) {
        const text = content.map((p: any) => (typeof p === 'string' ? p : (p?.text ?? p?.content ?? ''))).filter(Boolean).join('\n').trim();
        if (text) {
          result.finalAnswer = text;
          break;
        }
      }
    }
  }
  return result;
}
