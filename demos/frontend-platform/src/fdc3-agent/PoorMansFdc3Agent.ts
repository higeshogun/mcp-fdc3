
import { type DesktopAgent, type AppIdentifier, type AppIntent, type AppMetadata, type Channel, type Context, type ContextHandler, type ContextType, type EventHandler, type ImplementationMetadata, type Intent, type IntentHandler, type IntentResolution, type Listener, type PrivateChannel, ResolveError } from '@finos/fdc3';

export class PoorMansFdc3Agent implements DesktopAgent {
  open(app: AppIdentifier, context?: Context | undefined): Promise<AppIdentifier>;
  open(name: string, context?: Context | undefined): Promise<AppIdentifier>;
  open(name: unknown, context?: unknown): Promise<import("@finos/fdc3").AppIdentifier> {
    throw new Error('Method not implemented.');
  }

  findIntent(intent: Intent, context?: Context | undefined, resultType?: string | undefined): Promise<AppIntent> {
    throw new Error('Method not implemented.');
  }

  findIntentsByContext(context: Context, resultType?: string | undefined): Promise<AppIntent[]> {
    throw new Error('Method not implemented.');
  }

  async findInstances(app: AppIdentifier): Promise<AppIdentifier[]> {
    //TODO - This could only be stubbed out further if there was some proper DA functionality implemented in this class
    //So for now, let's simply create a synthetic instanceId to demonstrate how MCP-FDC3 library would operate if it
    //found an existing running instance of the app
    console.log('%cPoorMansFdc3Agent.findInstances', 'font-weight:bold;');
    console.log(`app.appId: ${app.appId}`);
    return Promise.resolve([
      {
        appId: app.appId,
        instanceId: window.crypto?.randomUUID(),
      }
    ] as Array<AppIdentifier>);
  }

  broadcast(context: Context): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async raiseIntent(intent: Intent, context: Context, app?: AppIdentifier | undefined): Promise<IntentResolution>;
  async raiseIntent(intent: Intent, context: Context, name: string): Promise<IntentResolution>;
  async raiseIntent(intent: Intent, context: Context, appOrName?: AppIdentifier | string): Promise<IntentResolution> {
    console.log('%cPoorMansFdc3Agent.raiseIntent', 'font-weight:bold;');
    //TODO - Validate context and throw ResolveError.MalformedContext error if necessary
    const app: AppIdentifier | undefined = this._deriveAppIdentifier(appOrName);
    if (!app) {
      throw new Error(ResolveError.NoAppsFound);
    }
    // For now, let's simply log out the arguments received by this FDC3 Desktop Agent API method
    // This allows use to prove that MCP-FDC3 library can be used to trigger FDC3 interop via an AI Agent response to a user prompt
    console.log(`intent: ${intent}`);
    console.log('context:');
    console.log(context);
    console.log('app:');
    console.log(app);

    //TODO - Stub out further. Or perhaps replace with reference implementation of an FDC3 DA from finos/FDC3 repo
  }

  raiseIntentForContext(context: Context, app?: AppIdentifier | undefined): Promise<IntentResolution>;
  raiseIntentForContext(context: Context, name: string): Promise<IntentResolution>;
  raiseIntentForContext(context: unknown, name?: unknown): Promise<IntentResolution> {
    throw new Error('Method not implemented.');
  }

  addIntentListener(intent: Intent, handler: IntentHandler): Promise<Listener> {
    throw new Error('Method not implemented.');
  }

  addContextListener(contextType: ContextType | null, handler: ContextHandler): Promise<Listener>;
  addContextListener(handler: ContextHandler): Promise<Listener>;
  addContextListener(contextType: unknown, handler?: unknown): Promise<Listener> {
    throw new Error('Method not implemented.');
  }

  addEventListener(type: 'userChannelChanged' | null, handler: EventHandler): Promise<Listener> {
    throw new Error('Method not implemented.');
  }

  getUserChannels(): Promise<Channel[]> {
    throw new Error('Method not implemented.');
  }

  joinUserChannel(channelId: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  getOrCreateChannel(channelId: string): Promise<Channel> {
    throw new Error('Method not implemented.');
  }

  createPrivateChannel(): Promise<PrivateChannel> {
    throw new Error('Method not implemented.');
  }

  getCurrentChannel(): Promise<Channel | null> {
    throw new Error('Method not implemented.');
  }

  leaveCurrentChannel(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  getInfo(): Promise<ImplementationMetadata> {
    throw new Error('Method not implemented.');
  }

  getAppMetadata(app: AppIdentifier): Promise<AppMetadata> {
    throw new Error('Method not implemented.');
  }

  getSystemChannels(): Promise<Channel[]> {
    throw new Error('Method not implemented.');
  }

  joinChannel(channelId: string): Promise<void> {
    throw new Error('Method not implemented.');
  }

  private _deriveAppIdentifier(appOrName?: AppIdentifier | string): AppIdentifier | undefined {
    let app: AppIdentifier | undefined;
    if (appOrName && typeof appOrName === 'object' && appOrName.appId) {
      app = appOrName as AppIdentifier;
    } else if (appOrName && typeof appOrName === 'string') {
      app = {
        appId: appOrName
      } as AppIdentifier;
    }
    return app;
  }
}
