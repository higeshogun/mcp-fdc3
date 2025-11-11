import type { EmbeddedResource, Resource } from '@modelcontextprotocol/sdk/types.js';

export type Fdc3Resource = {
  type: 'resource';
  resource: Fdc3MessageTextContent | Base64BlobContent;
  annotations?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
};

export const Fdc3ApiUri = 'fdc3://api-method-request';

export const Fdc3ApiMimeType = 'application/vnd.mcp-fdc3.fdc3-api-method-request';

export const Fdc3ApiMethodRequestPayloadType = 'fdc3ApiMethodRequest';

export type Fdc3MessageTextContent = {
  uri: typeof Fdc3ApiUri;
  mimeType: typeof Fdc3ApiMimeType;
  text: string; // FDC3 message JSON content
  blob?: never;
  _meta?: Record<string, unknown>;
};

export type Base64BlobContent = {
  uri: typeof Fdc3ApiUri;
  mimeType: typeof Fdc3ApiMimeType;
  blob: string; //  Base64 encoded FDC3 message JSON content
  text?: never;
  _meta?: Record<string, unknown>;
};

export type Fdc3ResourceContentPayload = {
  type: typeof Fdc3ApiMethodRequestPayloadType;
  fdc3MessageJson: string
}

export interface CreateFdc3ResourceOptions {
  uri: typeof Fdc3ApiUri;
  content: Fdc3ResourceContentPayload;
  encoding: 'text' | 'blob';
  metadata?: Record<string, unknown>;
  resourceProps?: Fdc3ResourceProps;
  embeddedResourceProps?: EmbeddedFdc3ResourceProps;
}

export type Fdc3ResourceProps = Omit<Partial<Resource>, 'uri' | 'mimeType'>;

export type EmbeddedFdc3ResourceProps = Omit<Partial<EmbeddedResource>, 'resource' | 'type'>;
