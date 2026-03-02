
import { type DesktopAgent, type AppIdentifier, type AppIntent, type AppMetadata, type Channel, type Context, type ContextHandler, type ContextType, type EventHandler, type ImplementationMetadata, type Intent, type IntentHandler, type IntentResolution, type Listener, type PrivateChannel, ResolveError } from '@finos/fdc3';

export interface Fdc3PostMessage {
  source: 'mcp-fdc3-platform';
  type: 'raiseIntent' | 'broadcast' | 'clearFilter';
  intent?: Intent;
  context?: Context;
}

/**
 * PoorMansFdc3Agent — broadcasts FDC3 messages to ALL registered iframe windows.
 * Use registerWindow() / unregisterWindow() to add/remove panels.
 */
export class PoorMansFdc3Agent implements DesktopAgent {
  private _windows = new Set<Window>();

  registerWindow(win: Window | null | undefined): void {
    if (win) {
      this._windows.add(win);
      console.log(`%cPoorMansFdc3Agent: registered window (total: ${this._windows.size})`, 'color:#3fb950;font-weight:bold;');
    }
  }

  unregisterWindow(win: Window | null | undefined): void {
    if (win) this._windows.delete(win);
  }

  /** Broadcast a raw message to all registered windows. */
  private _broadcast(msg: Fdc3PostMessage): void {
    if (this._windows.size === 0) {
      console.warn('PoorMansFdc3Agent: no registered windows to broadcast to');
      return;
    }
    this._windows.forEach(win => {
      try { win.postMessage(msg, '*'); } catch (_) { }
    });
    console.log(`%cPoorMansFdc3Agent: broadcast to ${this._windows.size} window(s)`, 'color:#58a6ff;font-weight:bold;', msg);
  }

  // ── DesktopAgent — implemented methods ──────────────────────────────────

  async raiseIntent(intent: Intent, context: Context, app?: AppIdentifier | string): Promise<IntentResolution> {
    console.log('%cPoorMansFdc3Agent.raiseIntent', 'font-weight:bold;', { intent, context });

    const appId = typeof app === 'string' ? app : app?.appId;
    if (!appId) throw new Error(ResolveError.NoAppsFound);

    this._broadcast({ source: 'mcp-fdc3-platform', type: 'raiseIntent', intent, context });

    return {
      source: { appId } as AppIdentifier,
      version: '2.0',
      intent,
      getResult: () => Promise.resolve({} as import('@finos/fdc3').IntentResult),
    } as IntentResolution;
  }

  async findInstances(app: AppIdentifier): Promise<AppIdentifier[]> {
    return [{ appId: app.appId, instanceId: window.crypto?.randomUUID() }];
  }

  // ── DesktopAgent — stubs ────────────────────────────────────────────────

  open(_app: AppIdentifier, _context?: Context): Promise<AppIdentifier>;
  open(_name: string, _context?: Context): Promise<AppIdentifier>;
  open(_name: unknown, _context?: unknown): Promise<AppIdentifier> { throw new Error('Not implemented'); }
  findIntent(_i: Intent, _c?: Context, _r?: string): Promise<AppIntent> { throw new Error('Not implemented'); }
  findIntentsByContext(_c: Context, _r?: string): Promise<AppIntent[]> { throw new Error('Not implemented'); }
  broadcast(_c: Context): Promise<void> { throw new Error('Not implemented'); }
  raiseIntentForContext(_c: Context, _a?: AppIdentifier | string): Promise<IntentResolution>;
  raiseIntentForContext(_c: unknown, _a?: unknown): Promise<IntentResolution> { throw new Error('Not implemented'); }
  addIntentListener(_i: Intent, _h: IntentHandler): Promise<Listener> { throw new Error('Not implemented'); }
  addContextListener(_ct: ContextType | null, _h: ContextHandler): Promise<Listener>;
  addContextListener(_h: ContextHandler): Promise<Listener>;
  addContextListener(_ct: unknown, _h?: unknown): Promise<Listener> { throw new Error('Not implemented'); }
  addEventListener(_t: 'userChannelChanged' | null, _h: EventHandler): Promise<Listener> { throw new Error('Not implemented'); }
  getUserChannels(): Promise<Channel[]> { throw new Error('Not implemented'); }
  joinUserChannel(_id: string): Promise<void> { throw new Error('Not implemented'); }
  getOrCreateChannel(_id: string): Promise<Channel> { throw new Error('Not implemented'); }
  createPrivateChannel(): Promise<PrivateChannel> { throw new Error('Not implemented'); }
  getCurrentChannel(): Promise<Channel | null> { throw new Error('Not implemented'); }
  leaveCurrentChannel(): Promise<void> { throw new Error('Not implemented'); }
  getInfo(): Promise<ImplementationMetadata> { throw new Error('Not implemented'); }
  getAppMetadata(_a: AppIdentifier): Promise<AppMetadata> { throw new Error('Not implemented'); }
  getSystemChannels(): Promise<Channel[]> { throw new Error('Not implemented'); }
  joinChannel(_id: string): Promise<void> { throw new Error('Not implemented'); }
}
