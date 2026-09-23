//TODO - Consider moving/consolidating some of these types to a new 'shared' library to avoid duplication

type URI = 'fdc3://api-method-request';

type MimeType = 'application/vnd.mcp-fdc3.fdc3-api-method-request';

export interface AIConfig {
  provider: 'openai' | 'gemini' | 'ollama' | 'custom';
  baseUrl?: string;
  apiKey?: string;
  model: string;
  whisperUrl?: string;
  ttsProvider?: 'ttsServer' | 'browser' | 'none';
  ttsUrl?: string;
  ttsApiKey?: string;
  ttsVoice?: string;
  ttsModel?: string;
  ttsAutoPlay?: boolean;
  realtimeEngine?: 'websocket' | 'openai-realtime' | 'gemini-live' | 'pipeline';
  realtimeTransport?: 'websocket' | 'webrtc';
  realtimeWsUrl?: string;
  realtimeApiKey?: string;
  geminiApiKey?: string;
  geminiVoice?: 'Puck' | 'Charon' | 'Kore' | 'Fenrir' | 'Aoede';
  geminiModel?: string;
  systemPrompt?: string;
  vadSensitivity?: number;
}

export interface McpResource {
  uri: URI;
  mimeType: MimeType;
  text: string; // FDC3 message JSON content
  blob?: never;
  _meta?: Record<string, unknown>;
}

export interface StructuredMessage {
  finalAnswer?: string;
  mcpResource?: McpResource;
  toolCalls?: any[];
  textContent?: string;
}

export interface Interaction {
  question: string;
  response: any;
  finalAnswer?: string;
  mcpResource?: McpResource;
  isError?: boolean;
}
