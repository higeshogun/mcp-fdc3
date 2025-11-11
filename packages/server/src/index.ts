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
    throw new Error(`MCP-FDC3 library: URI must be '${Fdc3ApiUri}' when content.type is '${Fdc3ApiMethodRequestPayloadType}'.`);
  }
  if (options?.content?.type !== Fdc3ApiMethodRequestPayloadType) {
    throw new Error(`MCP-FDC3 library: Invalid content.type specified: ${options.content.type}`);
  }
  if (typeof options?.content?.fdc3MessageJson !== 'string') {
    throw new Error(`MCP-FDC3 library: content.fdc3MessageJson must be provided as a JSON string when content.type is '${Fdc3ApiMethodRequestPayloadType}'.`);
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
  //TODO - There are at least a couple of things to consider here:
  //1. The fdc3.raiseIntent method would arguably benefit from a having an optional 'firstOrDefault' mechanism.
  //   When targeting a single running instance of a given app, this would avoid the need to first invoke fdc3.findInstances
  //   in order to raise the intent on the first instance.
  //   MCP-FDC3 library could potentially offer 'firstOrDefault' as an additional option e.g. with the client library processing
  //   the option (only when set) by invoking fdc3.findInstances and then fdc3.raiseIntent. When the option was not set, MCP-FDC3
  //   client library could simply just invoke fdc3.raiseIntent.
  //   But a better solution might be to extend the FDC3 API to natively support this functionality. This would avoid the need for
  //   'special' options in the MCP-FDC3 library, and moreover would make the functionality available to regular client-side app
  //   code that consumes the FDC3 API.
  //2. Launching of new instances of target apps - see the comment in the 'createFdc3OpenResource' method below for thoughts on this.
  const fdc3Message: BrowserTypes.RaiseIntentRequest = {
    type: 'raiseIntentRequest',
    payload: {
      app,
      context,
      intent,
    },
    meta: {
      requestUuid: (globalThis as any).crypto?.randomUUID(),
      source: undefined, //TODO - This needs more thought. What does 'originating app identity' actually mean in the context of an intent created by an MCP server and subsequently raised by the platform app?
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
  //TODO - Explore and discuss what options there are for processing this resource on the client side.
  //This is important because a frontend app will typically be unable to invoke a window.open without an associated user gesture.
  //Requiring originating user gestures is one of the mechanisms modern browsers employ to help overcome the 'popup hell' of the earlier 2000s.
  //Some potential solutions include:
  //(a) open the new app inside an iframe within the main window
  //(b) provide the user with a button (or better yet, a thumbnail) allowing them to launch the app in a secondary window
  //(c) open in iframe as per option (a) but with a button to support tear-off into a secondary window (but be aware this will trigger a reload of the new app)
  //But any and all solutions should be put on the table.
  const fdc3Message: BrowserTypes.OpenRequest = {
    type: 'openRequest',
    payload: {
      app,
      context,
    },
    meta: {
      requestUuid: (globalThis as any).crypto?.randomUUID(),
      source: undefined, //TODO - This needs more thought. What does 'originating app identity' actually mean in the context of an intent created by an MCP server and subsequently raised by the platform app?
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
      channelId: '', //TODO - This needs more thought. If we use generated type from the FDC3 library, it expects a channelId here...
      context,
    },
    meta: {
      requestUuid: (globalThis as any).crypto?.randomUUID(),
      source: undefined, //TODO - This needs more thought. What does 'originating app identity' actually mean in the context of an intent created by an MCP server and subsequently raised by the platform app?
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
