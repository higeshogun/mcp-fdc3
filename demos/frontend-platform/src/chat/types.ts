//TODO - Consider moving/consolidating some of these types to a new 'shared' library to avoid duplication

type URI = 'fdc3://api-method-request';

type MimeType = 'application/vnd.mcp-fdc3.fdc3-api-method-request';

export interface McpResource {
  uri: URI;
  mimeType: MimeType;
  text: string; // FDC3 message JSON content
  blob?: never;
  _meta?: Record<string, unknown>;
};

export interface StructuredMessage {
  finalAnswer?: string;
  mcpResource?: McpResource;
}

export interface Interaction {
  question: string;
  response: string;
  finalAnswer?: string;
  mcpResource?: McpResource;
  isError?: boolean;
}
