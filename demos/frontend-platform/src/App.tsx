import { useCallback, useEffect, useRef, useState } from 'react';
import { Chatbar } from './chat/Chatbar';
import { PoorMansFdc3Agent } from './fdc3-agent/PoorMansFdc3Agent';
import { GoldenLayoutWrapper } from './components/GoldenLayoutWrapper';
import { LayoutConfig, GoldenLayout } from 'golden-layout';
import './App.css';

const fdc3Agent = new PoorMansFdc3Agent();

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
      },
      {
        type: 'column',
        content: [
          {
            type: 'component',
            componentType: 'iframePanel',
            title: 'Order Ticket',
            height: 40,
            componentState: {
              url: '/demos/frontend-app-order-ticket/index.html',
              icon: '⚡',
              title: 'Order Ticket',
              cls: 'ticket'
            }
          },
          {
            type: 'stack',
            content: [
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

  // Handle navigateAndRaiseIntent from child apps
  // Note: We're broadcasting this to ALL registered windows now,
  // since Golden Layout makes it harder to maintain refs to specific iframes by ID
  const handleChildMessage = useCallback((event: MessageEvent) => {
    const msg = event.data;
    if (!msg || msg.source !== 'mcp-fdc3-app') return;

    if (msg.type === 'navigateAndRaiseIntent') {
      const fdc3Msg = {
        source: 'mcp-fdc3-platform' as const,
        type: 'raiseIntent' as const,
        intent: msg.intent ?? 'ViewInstrument',
        context: msg.context,
      };

      // FDC3 Agent will handle routing this if we use its APIs,
      // but for PoorMans we just broadcast to all iframes
      const iframes = document.querySelectorAll('iframe.panel-frame');
      iframes.forEach((ifr: Element) => {
        const win = (ifr as HTMLIFrameElement).contentWindow;
        if (win && win !== event.source && typeof win.postMessage === 'function') {
          win.postMessage(fdc3Msg, '*');
        }
      });
    }
  }, []);

  useEffect(() => {
    window.addEventListener('message', handleChildMessage);
    return () => window.removeEventListener('message', handleChildMessage);
  }, [handleChildMessage]);

  const addPanel = (url: string, title: string, icon: string, cls: string) => {
    if (!layoutReady || !layoutReady.rootItem) return;

    // Use GL's addComponent to push a new component into the layout tree
    try {
      layoutReady.addComponent('iframePanel', { url, icon, title, cls }, title);
    } catch (e) {
      console.error("Could not add panel", e);
    }
  };

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
            <button className="launcher-btn" onClick={() => addPanel('/demos/frontend-app-watchlist/index.html', 'Watchlist', '📊', 'watchlist')}>View Watchlist</button>
            <button className="launcher-btn" onClick={() => addPanel('/demos/frontend-app-news/index.html', 'News Feed', '📰', 'news')}>View News Feed</button>
            <button className="launcher-btn" onClick={() => addPanel('/demos/frontend-app-order-ticket/index.html', 'Order Ticket', '⚡', 'ticket')}>New Order Ticket</button>
            <button className="launcher-btn" onClick={() => addPanel('/demos/frontend-app-blotter/index.html', 'Orders Blotter', '📋', 'blotter')}>View Orders</button>
            <button className="launcher-btn" onClick={() => addPanel('/demos/frontend-app-trade-blotter/index.html', 'Trade Blotter', '🧾', 'trade-blotter')}>View Trades</button>
            <button className="launcher-btn" onClick={() => addPanel('/demos/frontend-app-rfq/index.html', 'RFQ Panel', '💬', 'rfq')}>New RFQ</button>
          </div>
        </header>
      )}
      <div style={{ flex: 1, position: 'relative' }}>
        <GoldenLayoutWrapper config={initialConfig} components={components} onLayoutReady={setLayoutReady} />
      </div>
    </div>
  );
}

export default App;
