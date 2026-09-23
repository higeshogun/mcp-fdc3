import { AppIdentifier, Context, BrowserTypes } from '@finos/fdc3';
import {
  Fdc3MessageTextContent,
  Base64BlobContent,
  Fdc3ResourceContentPayload,
  CreateFdc3ResourceOptions,
  Fdc3Resource,
  Fdc3ApiUri,
  Fdc3ApiMimeType,
  Fdc3ApiMethodRequestPayloadType,
} from './types';

export type {
  CreateFdc3ResourceOptions,
  Fdc3ResourceContentPayload,
  Fdc3Resource,
} from './types';


/**
 * Creates a generic Fdc3Resource.
 * This is the object that should be included in the 'content' array of a toolResult.
 * @param options Configuration for the FDC3 resource.
 * @returns a Fdc3Resource.
 */
export function createGenericFdc3Resource(options: CreateFdc3ResourceOptions): Fdc3Resource {
  if (options?.uri !== Fdc3ApiUri) {
    throw new Error(`MCP-FDC3 server library: URI must be '${Fdc3ApiUri}' when content.type is '${Fdc3ApiMethodRequestPayloadType}'.`);
  }
  if (options?.content?.type !== Fdc3ApiMethodRequestPayloadType) {
    throw new Error(`MCP-FDC3 server library: Invalid content.type specified: ${options.content.type}`);
  }
  if (typeof options?.content?.fdc3MessageJson !== 'string') {
    throw new Error(`MCP-FDC3 server library: content.fdc3MessageJson must be provided as a JSON string when content.type is '${Fdc3ApiMethodRequestPayloadType}'.`);
  }

  let resource: Fdc3MessageTextContent | Base64BlobContent;
  switch (options.encoding) {
    case 'text':
      resource = {
        uri: options.uri,
        mimeType: Fdc3ApiMimeType,
        text: options?.content?.fdc3MessageJson,
      };
      break;
    case 'blob':
      throw new Error('blob encoding not implemented yet');
      break;
    default: {
      throw new Error(`MCP-FDC3 library: Invalid encoding type: ${options.encoding}`);
    }
  }

  return {
    type: 'resource',
    resource: resource,
    ...(options.embeddedResourceProps ?? {}),
  };
}

function getSafeUuid(): string {
  try {
    if (typeof globalThis !== 'undefined' && typeof (globalThis as any).crypto?.randomUUID === 'function') {
      return (globalThis as any).crypto.randomUUID();
    }
  } catch {}
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Creates an fdc3.raiseIntent Fdc3Resource.
 * This is the object that should be included in the 'content' array of a toolResult.
 * @param intent Name of the intent to be raised e.g. ViewInstrument.
 * @param context Structured data to send (along with the intent) to the target application e.g. an fdc3.instrument context object.
 * @param app Identifier of the target application.
 * @returns a Fdc3Resource.
 */
export function createFdc3RaiseIntentResource(intent: string,
                                              context: Context,
                                              app?: AppIdentifier): Fdc3Resource {
  const fdc3Message: BrowserTypes.RaiseIntentRequest = {
    type: 'raiseIntentRequest',
    payload: {
      app,
      context,
      intent,
    },
    meta: {
      requestUuid: getSafeUuid(),
      source: undefined,
      timestamp: new Date(),
    },
  };
  return createGenericFdc3Resource({
    uri: Fdc3ApiUri,
    content: {
      type: Fdc3ApiMethodRequestPayloadType,
      fdc3MessageJson: JSON.stringify(fdc3Message),
    },
    encoding: 'text',
  });
}

/**
 * Creates an fdc3.open Fdc3Resource.
 * This is the object that should be included in the 'content' array of a toolResult.
 * @param app Identifier of the application to be opened.
 * @param context Structured data to provide to the opened application e.g. a fdc3.instrument context object.
 * @returns a Fdc3Resource.
 */
export function createFdc3OpenResource(app: AppIdentifier,
                                       context?: Context): Fdc3Resource {
  const fdc3Message: BrowserTypes.OpenRequest = {
    type: 'openRequest',
    payload: {
      app,
      context,
    },
    meta: {
      requestUuid: getSafeUuid(),
      source: undefined,
      timestamp: new Date(),
    },
  };
  return createGenericFdc3Resource({
    uri: Fdc3ApiUri,
    content: {
      type: Fdc3ApiMethodRequestPayloadType,
      fdc3MessageJson: JSON.stringify(fdc3Message),
    },
    encoding: 'text',
  });
}

/**
 * Creates an fdc3.broadcast Fdc3Resource.
 * This is the object that should be included in the 'content' array of a toolResult.
 * @param context Structured data to publish on the current channel e.g. an fdc3.instrument context object.
 * @returns a Fdc3Resource.
 */
export function createFdc3BroadcastResource(context: Context): Fdc3Resource {
  const fdc3Message: BrowserTypes.BroadcastRequest = {
    type: 'broadcastRequest',
    payload: {
      channelId: '',
      context,
    },
    meta: {
      requestUuid: getSafeUuid(),
      source: undefined,
      timestamp: new Date(),
    },
  };
  return createGenericFdc3Resource({
    uri: Fdc3ApiUri,
    content: {
      type: Fdc3ApiMethodRequestPayloadType,
      fdc3MessageJson: JSON.stringify(fdc3Message),
    },
    encoding: 'text',
  });
}
