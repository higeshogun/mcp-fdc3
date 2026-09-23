import { useCallback, useEffect, useRef, useState } from 'react';
import { Chatbar } from './chat/Chatbar';
import { PoorMansFdc3Agent } from './fdc3-agent/PoorMansFdc3Agent';
import { GoldenLayoutWrapper } from './components/GoldenLayoutWrapper';
import { LayoutConfig, GoldenLayout } from 'golden-layout';
import { generateUUID } from './utils/uuid';
import { registerChromeWebMcpTools } from './mcp/webMcpServer';
import { DeclarativeWebMcpTools } from './components/DeclarativeWebMcpTools';
import './App.css';

const FDC3_SESSION_STORAGE_KEY = 'mcp-fdc3-ui-session-id';

function getFdc3SessionId(): string {
  const existing = window.sessionStorage.getItem(FDC3_SESSION_STORAGE_KEY);
  if (existing) {
    return existing;
  }

  const created = generateUUID();
  window.sessionStorage.setItem(FDC3_SESSION_STORAGE_KEY, created);
  return created;
}

const platformOrigin = window.location.origin;
const fdc3SessionId = getFdc3SessionId();
const fdc3Agent = new PoorMansFdc3Agent(fdc3SessionId);

// Register WebMCP tools with Chrome DevTools & Chrome Built-in AI (document.modelContext)
registerChromeWebMcpTools(fdc3Agent);

// Map panel types to their configs
interface IframePanelProps {
  url: string;
  icon: string;
  title: string;
  cls: string;
}

const IframePanel = ({ url, title }: IframePanelProps) => {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    if (iframeRef.current?.contentWindow) {
      fdc3Agent.registerWindow(iframeRef.current.contentWindow);
    }
    return () => {
      if (iframeRef.current?.contentWindow) {
        fdc3Agent.unregisterWindow(iframeRef.current.contentWindow);
      }
    };
  }, []);

  return (
    <div className="panel" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column' }}>
      <iframe
        src={url}
        title={title}
        className="panel-frame"
        ref={iframeRef}
        style={{ flex: 1, border: 'none', minHeight: 0 }}
      />
    </div>
  );
};

const ChatPanel = () => {
  return (
    <div className="panel chat-panel" style={{ width: '100%', height: '100%' }}>
      <Chatbar fdc3Agent={fdc3Agent} />
    </div>
  );
};

// ── App Configuration ──────────────────────────────────────────────────────
const initialConfig: LayoutConfig = {
  root: {
    type: 'row',
    content: [
      {
        type: 'column',
        width: 28,
        content: [
          {
            type: 'component',
            componentType: 'chat',
            title: 'Chat',
            height: 55,
          },
          {
            type: 'component',
            componentType: 'iframePanel',
            componentState: {
              url: '/demos/frontend-app-news/index.html',
              icon: '📰',
              title: 'News Feed',
              cls: 'news'
            },
            title: 'News Feed'
          }
        ]
      },
      {
        type: 'column',
        width: 38,
        content: [
          {
            type: 'component',
            componentType: 'iframePanel',
            title: 'Watchlist',
            height: 50,
            componentState: {
              url: '/demos/frontend-app-watchlist/index.html',
              icon: '📊',
              title: 'Watchlist',
              cls: 'watchlist'
            }
          },
          {
            type: 'stack',
            content: [
              {
                type: 'component',
                componentType: 'iframePanel',
                title: 'Chart',
                componentState: {
                  url: '/demos/frontend-app-chart/index.html',
                  icon: '📈',
                  title: 'Chart',
                  cls: 'chart'
                }
              },
              {
                type: 'component',
                componentType: 'iframePanel',
                title: 'RFQ Panel',
                componentState: {
                  url: '/demos/frontend-app-rfq/index.html',
                  icon: '💬',
                  title: 'RFQ Panel',
                  cls: 'rfq'
                }
              }
            ]
          }
        ]
      },
      {
        type: 'column',
        content: [
          {
            type: 'stack',
            height: 42,
            content: [
              {
                type: 'component',
                componentType: 'iframePanel',
                title: 'Order Ticket',
                componentState: {
                  url: '/demos/frontend-app-order-ticket/index.html',
                  icon: '⚡',
                  title: 'Order Ticket',
                  cls: 'ticket'
                }
              },
              {
                type: 'component',
                componentType: 'iframePanel',
                title: 'Account',
                componentState: {
                  url: '/demos/frontend-app-account/index.html',
                  icon: '💰',
                  title: 'Account Summary',
                  cls: 'account'
                }
              }
            ]
          },
          {
            type: 'stack',
            content: [
              {
                type: 'component',
                componentType: 'iframePanel',
                title: 'Positions',
                componentState: {
                  url: '/demos/frontend-app-positions/index.html',
                  icon: '💼',
                  title: 'Positions',
                  cls: 'positions'
                }
              },
              {
                type: 'component',
                componentType: 'iframePanel',
                title: 'Orders',
                componentState: {
                  url: '/demos/frontend-app-blotter/index.html',
                  icon: '📋',
                  title: 'Orders Blotter',
                  cls: 'blotter'
                }
              },
              {
                type: 'component',
                componentType: 'iframePanel',
                title: 'Trades',
                componentState: {
                  url: '/demos/frontend-app-trade-blotter/index.html',
                  icon: '🧾',
                  title: 'Trade Blotter',
                  cls: 'trade-blotter'
                }
              }
            ]
          }
        ]
      }
    ]
  }
};

const components = {
  chat: ChatPanel,
  iframePanel: IframePanel
};

function App() {
  const [layoutReady, setLayoutReady] = useState<GoldenLayout | null>(null);

  const switchToTab = useCallback((url: string, title?: string): boolean => {
    if (!layoutReady || !layoutReady.rootItem) return false;

    // Helper: traverse GoldenLayout content tree to find the ComponentItem
    const findComponent = (item: any): any => {
      if (!item) return null;
      if (item.isComponent) {
        const state = item.container?.state || item.container?.initialState;
        const stateUrl = state?.url;
        const itemTitle = item.title;
        const compType = item.componentType;

        if (url && stateUrl && (stateUrl === url || stateUrl.includes(url) || url.includes(stateUrl))) {
          return item;
        }
        if (title && itemTitle && (
          itemTitle.toLowerCase() === title.toLowerCase() ||
          itemTitle.toLowerCase().includes(title.toLowerCase()) ||
          title.toLowerCase().includes(itemTitle.toLowerCase())
        )) {
          return item;
        }
        if (title && title.toLowerCase() === 'chat' && compType === 'chat') {
          return item;
        }
      }
      if (item.contentItems && Array.isArray(item.contentItems)) {
        for (const child of item.contentItems) {
          const found = findComponent(child);
          if (found) return found;
        }
      }
      return null;
    };

    const targetItem = findComponent(layoutReady.rootItem);
    let switched = false;

    if (targetItem) {
      try {
        if (targetItem.parentItem && typeof targetItem.parentItem.setActiveComponentItem === 'function') {
          targetItem.parentItem.setActiveComponentItem(targetItem, true);
          switched = true;
        }
        if (typeof targetItem.focus === 'function') {
          targetItem.focus();
          switched = true;
        }
      } catch (e) {
        console.warn('[GoldenLayout] Error activating component item:', e);
      }
    }

    // Secondary DOM fallback: find the corresponding tab in GoldenLayout header and click it
    const candidateTitles = [
      title,
      targetItem?.title,
    ].filter(Boolean).map(t => (t as string).toLowerCase());

    const tabs = document.querySelectorAll<HTMLElement>('.lm_header .lm_tab');
    for (const tab of tabs) {
      const titleEl = tab.querySelector('.lm_title');
      const text = titleEl?.textContent?.trim().toLowerCase();
      if (text && candidateTitles.some(c => text === c || text.includes(c) || c.includes(text))) {
        tab.click();
        switched = true;
        break;
      }
    }

    try {
      layoutReady.updateRootSize();
    } catch {}

    return switched;
  }, [layoutReady]);

  const appMap: Record<string, { url: string; title: string; icon: string; cls: string }> = {
    'frontend-app-order-ticket': { url: '/demos/frontend-app-order-ticket/index.html', title: 'Order Ticket', icon: '⚡', cls: 'ticket' },
    'frontend-app-blotter': { url: '/demos/frontend-app-blotter/index.html', title: 'Orders Blotter', icon: '📋', cls: 'blotter' },
    'frontend-app-trade-blotter': { url: '/demos/frontend-app-trade-blotter/index.html', title: 'Trade Blotter', icon: '🧾', cls: 'trade-blotter' },
    'frontend-app-rfq': { url: '/demos/frontend-app-rfq/index.html', title: 'RFQ Panel', icon: '💬', cls: 'rfq' },
    'frontend-app-news': { url: '/demos/frontend-app-news/index.html', title: 'News Feed', icon: '📰', cls: 'news' },
    'frontend-app-watchlist': { url: '/demos/frontend-app-watchlist/index.html', title: 'Watchlist', icon: '📊', cls: 'watchlist' },
    'frontend-app-chart': { url: '/demos/frontend-app-chart/index.html', title: 'Chart', icon: '📈', cls: 'chart' },
    'frontend-app-positions': { url: '/demos/frontend-app-positions/index.html', title: 'Positions', icon: '💼', cls: 'positions' },
    'frontend-app-account': { url: '/demos/frontend-app-account/index.html', title: 'Account Summary', icon: '💰', cls: 'account' },
    'chat': { url: '', title: 'Chat', icon: '🤖', cls: 'chat' },
    'frontend-app-chat': { url: '', title: 'Chat', icon: '🤖', cls: 'chat' },
  };

  // Handle navigateAndRaiseIntent from child apps
  const handleChildMessage = useCallback((event: MessageEvent) => {
    if (event.origin !== platformOrigin) return;

    const msg = event.data;
    if (!msg || msg.source !== 'mcp-fdc3-app') return;

    if (msg.type === 'navigateAndRaiseIntent') {
      if (msg.targetTab) {
        const tabToAppId: Record<string, string> = {
          'blotter': 'frontend-app-blotter',
          'orderBlotter': 'frontend-app-blotter',
          'tradeBlotter': 'frontend-app-trade-blotter',
          'trades': 'frontend-app-trade-blotter',
          'chart': 'frontend-app-chart',
          'rfq': 'frontend-app-rfq',
          'orderTicket': 'frontend-app-order-ticket',
          'ticket': 'frontend-app-order-ticket',
          'positions': 'frontend-app-positions',
          'account': 'frontend-app-account',
          'news': 'frontend-app-news',
          'watchlist': 'frontend-app-watchlist',
          'chat': 'chat',
        };
        const targetId = tabToAppId[msg.targetTab];
        if (targetId && appMap[targetId]) {
          const cfg = appMap[targetId];
          switchToTab(cfg.url, cfg.title);
        }
      }

      const fdc3Msg = {
        source: 'mcp-fdc3-platform' as const,
        type: 'raiseIntent' as const,
        sessionId: fdc3SessionId,
        intent: msg.intent ?? 'ViewInstrument',
        context: msg.context,
      };

      const iframes = document.querySelectorAll('iframe.panel-frame');
      iframes.forEach((ifr: Element) => {
        const win = (ifr as HTMLIFrameElement).contentWindow;
        if (win && win !== event.source && typeof win.postMessage === 'function') {
          win.postMessage(fdc3Msg, platformOrigin);
        }
      });
    }
  }, [switchToTab]);

  useEffect(() => {
    window.addEventListener('message', handleChildMessage);
    return () => window.removeEventListener('message', handleChildMessage);
  }, [handleChildMessage]);

  useEffect(() => {
    registerChromeWebMcpTools(fdc3Agent);
  }, []);

  const addPanel = useCallback((url: string, title: string, icon: string, cls: string) => {
    if (!layoutReady || !layoutReady.rootItem) return;

    try {
      layoutReady.addComponent('iframePanel', { url, icon, title, cls }, title);
    } catch (e) {
      console.error("Could not add panel", e);
    }
  }, [layoutReady]);

  const addChatPanel = useCallback(() => {
    if (!layoutReady || !layoutReady.rootItem) return;
    try {
      layoutReady.addComponent('chat', {}, 'Chat');
    } catch (e) {
      console.error("Could not add chat panel", e);
    }
  }, [layoutReady]);

  const openOrSwitchToPanel = useCallback((url: string, title: string, icon: string, cls: string) => {
    if (!layoutReady || !layoutReady.rootItem) return;

    const isOpen = !!document.querySelector(`iframe[src="${url}"]`);
    if (isOpen) {
      switchToTab(url, title);
    } else {
      addPanel(url, title, icon, cls);
      setTimeout(() => {
        switchToTab(url, title);
      }, 150);
    }
  }, [layoutReady, addPanel, switchToTab]);

  const openOrSwitchToChat = useCallback(() => {
    if (!layoutReady || !layoutReady.rootItem) return;
    const hasChat = !!document.querySelector('.chat-panel');
    if (hasChat) {
      switchToTab('', 'Chat');
    } else {
      addChatPanel();
      setTimeout(() => {
        switchToTab('', 'Chat');
      }, 150);
    }
  }, [layoutReady, addChatPanel, switchToTab]);

  useEffect(() => {
    const handleFdc3Intent = (e: Event) => {
      const { intent, context, appId } = (e as CustomEvent).detail;

      if (appId && appMap[appId]) {
        const cfg = appMap[appId];
        if (cfg.url) {
          const isOpen = !!document.querySelector(`iframe[src="${cfg.url}"]`);
          if (isOpen) {
            // Already opened -> immediately switch to that tab!
            switchToTab(cfg.url, cfg.title);
          } else {
            // Not opened yet -> add panel and switch to it
            addPanel(cfg.url, cfg.title, cfg.icon, cfg.cls);

            setTimeout(() => {
              switchToTab(cfg.url, cfg.title);
              const iframes = document.querySelectorAll('iframe.panel-frame');
              iframes.forEach((ifr: Element) => {
                const win = (ifr as HTMLIFrameElement).contentWindow;
                if (win && typeof win.postMessage === 'function') {
                  win.postMessage({ source: 'mcp-fdc3-platform', type: 'raiseIntent', sessionId: fdc3SessionId, intent, context }, platformOrigin);
                }
              });
            }, 300);
          }
        } else {
          // Chat panel
          switchToTab('', 'Chat');
        }
      }
    };

    const handleSwitchView = (e: Event) => {
      const { view, appId } = (e as CustomEvent).detail || {};
      const targetId = appId || (view ? (view === 'chat' ? 'chat' : `frontend-app-${view}`) : undefined);
      if (targetId && appMap[targetId]) {
        const cfg = appMap[targetId];
        if (cfg.url) {
          openOrSwitchToPanel(cfg.url, cfg.title, cfg.icon, cfg.cls);
        } else {
          openOrSwitchToChat();
        }
      }
    };

    window.addEventListener('fdc3-intent', handleFdc3Intent);
    window.addEventListener('switch-view', handleSwitchView);
    return () => {
      window.removeEventListener('fdc3-intent', handleFdc3Intent);
      window.removeEventListener('switch-view', handleSwitchView);
    };
  }, [addPanel, openOrSwitchToPanel, openOrSwitchToChat, switchToTab]);

  const isPopout = window.location.search.includes('gl-window');

  return (
    <div className="app-shell" style={{ width: '100vw', height: '100vh', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
      {isPopout ? (
        <header className="platform-header" style={{ justifyContent: 'flex-end', padding: '4px 12px' }}>
          <button className="launcher-btn" onClick={() => layoutReady?.emit('popIn')} style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#2ba84a', color: '#fff' }}>
            <span>⇲</span> Return to Main Workspace
          </button>
        </header>
      ) : (
        <header className="platform-header">
          <div className="header-brand">MCP-FDC3 Finsemble Alternative</div>
          <div className="launcher-menu">
            <span className="launcher-title">Launcher:</span>
            <button className="launcher-btn" onClick={openOrSwitchToChat}>🤖 Open Chat</button>
            <button className="launcher-btn" onClick={() => openOrSwitchToPanel('/demos/frontend-app-chart/index.html', 'Chart', '📈', 'chart')}>View Chart</button>
            <button className="launcher-btn" onClick={() => openOrSwitchToPanel('/demos/frontend-app-watchlist/index.html', 'Watchlist', '📊', 'watchlist')}>View Watchlist</button>
            <button className="launcher-btn" onClick={() => openOrSwitchToPanel('/demos/frontend-app-news/index.html', 'News Feed', '📰', 'news')}>View News Feed</button>
            <button className="launcher-btn" onClick={() => openOrSwitchToPanel('/demos/frontend-app-positions/index.html', 'Positions', '💼', 'positions')}>View Positions</button>
            <button className="launcher-btn" onClick={() => openOrSwitchToPanel('/demos/frontend-app-account/index.html', 'Account Summary', '💰', 'account')}>Account</button>
            <button className="launcher-btn" onClick={() => openOrSwitchToPanel('/demos/frontend-app-order-ticket/index.html', 'Order Ticket', '⚡', 'ticket')}>New Order Ticket</button>
            <button className="launcher-btn" onClick={() => openOrSwitchToPanel('/demos/frontend-app-blotter/index.html', 'Orders Blotter', '📋', 'blotter')}>View Orders</button>
            <button className="launcher-btn" onClick={() => openOrSwitchToPanel('/demos/frontend-app-trade-blotter/index.html', 'Trade Blotter', '🧾', 'trade-blotter')}>View Trades</button>
            <button className="launcher-btn" onClick={() => openOrSwitchToPanel('/demos/frontend-app-rfq/index.html', 'RFQ Panel', '💬', 'rfq')}>New RFQ</button>
          </div>
        </header>
      )}
      <div style={{ flex: 1, position: 'relative' }}>
        <GoldenLayoutWrapper config={initialConfig} components={components} onLayoutReady={setLayoutReady} />
      </div>
      <DeclarativeWebMcpTools fdc3Agent={fdc3Agent} />
    </div>
  );
}

export default App;
