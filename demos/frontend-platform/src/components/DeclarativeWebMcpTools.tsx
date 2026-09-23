import React from 'react';
import { getWebMcpClient } from '../mcp/webMcpServer';
import { handleMcpFdc3Resource } from '@mcp-fdc3/client/dist/mcp-fdc3-client.esm.js';

export const DeclarativeWebMcpTools: React.FC<{ fdc3Agent: any }> = ({ fdc3Agent }) => {
  const executeTool = async (name: string, args: any) => {
    const client = await getWebMcpClient();
    const result: any = await client.callTool({ name, arguments: args });
    let handled = false;
    for (const item of result?.content || []) {
      if (item.type === 'resource' && item.resource) {
        handleMcpFdc3Resource(fdc3Agent, item.resource);
        handled = true;
      }
    }
    if (!handled) {
      const fallback = result?.fdc3Resource || result?._meta?.fdc3;
      if (fallback) {
        handleMcpFdc3Resource(fdc3Agent, fallback);
      }
    }
    return result;
  };

  return (
    <div id="webmcp-declarative-tools" style={{ display: 'none' }} aria-hidden="true">
      {/* 1. getTrades tool */}
      <form
        // @ts-expect-error declarative WebMCP attributes
        toolname="getTrades"
        tooldescription="Returns historical trades for a given company and broadcasts an FDC3 fdc3.instrument context via the ViewInstrument intent, targeting the Trade Blotter. Example input: 'AAPL'."
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const companyName = String(fd.get('companyName') || '');
          await executeTool('getTrades', { companyName });
        }}
      >
        <input
          name="companyName"
          type="text"
          required
          // @ts-expect-error declarative WebMCP attributes
          toolparamdescription="Company name or ticker symbol (e.g. AAPL, NVIDIA, Microsoft)"
        />
        <button type="submit">Get Trades</button>
      </form>

      {/* 2. getNews tool */}
      <form
        // @ts-expect-error declarative WebMCP attributes
        toolname="getNews"
        tooldescription="Filters the news feed by broadcasting an FDC3 fdc3.instrument context via the ViewInstrument intent, targeting the News App. Example input: 'MSFT'."
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const companyName = String(fd.get('companyName') || '');
          await executeTool('getNews', { companyName });
        }}
      >
        <input
          name="companyName"
          type="text"
          required
          // @ts-expect-error declarative WebMCP attributes
          toolparamdescription="Company name or ticker symbol to filter news for (e.g. MSFT, AAPL)"
        />
        <button type="submit">Get News</button>
      </form>

      {/* 3. clearFilters tool */}
      <form
        // @ts-expect-error declarative WebMCP attributes
        toolname="clearFilters"
        tooldescription="Resets the workspace context by broadcasting an FDC3 fdc3.clear context via the ClearFilter intent to all panels (blotter, news, watchlist)."
        onSubmit={async (e) => {
          e.preventDefault();
          await executeTool('clearFilters', {});
        }}
      >
        <button type="submit">Clear Filters</button>
      </form>

      {/* 4. submitOrder tool */}
      <form
        // @ts-expect-error declarative WebMCP attributes
        toolname="submitOrder"
        tooldescription="Submits and executes an order immediately (market orders filled immediately, limit orders placed as pending on the blotter) via FDC3 SubmitOrder intent. Use this when the user explicitly asks to buy, sell, execute, or place an order right away."
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const side = String(fd.get('side') || 'buy');
          const quantity = Number(fd.get('quantity') || 100);
          const ticker = String(fd.get('ticker') || 'AAPL');
          const orderType = String(fd.get('orderType') || 'market');
          const price = fd.get('price') ? Number(fd.get('price')) : undefined;
          await executeTool('submitOrder', { side, quantity, ticker, orderType, price });
        }}
      >
        <input name="ticker" type="text" required />
        <select name="side">
          <option value="buy">buy</option>
          <option value="sell">sell</option>
        </select>
        <input name="quantity" type="number" required />
        <select name="orderType">
          <option value="market">market</option>
          <option value="limit">limit</option>
        </select>
        <input name="price" type="number" />
        <button type="submit">Submit Order</button>
      </form>

      {/* 5. stageOrder tool */}
      <form
        // @ts-expect-error declarative WebMCP attributes
        toolname="stageOrder"
        tooldescription="Stages and populates an order in the Order Ticket UI without executing it, allowing the trader to review, edit, or confirm quantities, side, and prices before manual submission. Use this when the user asks to stage, prepare, draft, or set up an order (e.g., 'Stage an order to buy 100 AAPL', 'Prepare a limit buy for 50 TSLA at 240')."
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const side = String(fd.get('side') || 'buy');
          const quantity = Number(fd.get('quantity') || 100);
          const ticker = String(fd.get('ticker') || 'AAPL');
          const orderType = String(fd.get('orderType') || 'market');
          const price = fd.get('price') ? Number(fd.get('price')) : undefined;
          await executeTool('stageOrder', { side, quantity, ticker, orderType, price });
        }}
      >
        <input name="ticker" type="text" required />
        <select name="side">
          <option value="buy">buy</option>
          <option value="sell">sell</option>
        </select>
        <input name="quantity" type="number" />
        <select name="orderType">
          <option value="market">market</option>
          <option value="limit">limit</option>
        </select>
        <input name="price" type="number" />
        <button type="submit">Stage Order</button>
      </form>

      {/* 5. requestQuote tool */}
      <form
        // @ts-expect-error declarative WebMCP attributes
        toolname="requestQuote"
        tooldescription="Constructs an FDC3 fdc3.order context and stages an RFQ via the InitiateRFQ intent in the RFQ panel for OTC instruments like FX pairs (e.g. EUR/USD)."
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const side = String(fd.get('side') || 'two-way');
          const quantity = Number(fd.get('quantity') || 1000000);
          const instrument = String(fd.get('instrument') || 'EUR/USD');
          await executeTool('requestQuote', { side, quantity, instrument });
        }}
      >
        <input name="instrument" type="text" required />
        <select name="side">
          <option value="buy">buy</option>
          <option value="sell">sell</option>
          <option value="two-way">two-way</option>
        </select>
        <input name="quantity" type="number" required />
        <button type="submit">Request Quote</button>
      </form>

      {/* 6. viewChart tool */}
      <form
        // @ts-expect-error declarative WebMCP attributes
        toolname="viewChart"
        tooldescription="Displays interactive financial charts (candlesticks, line/area, moving averages, volume) for an equity or FX instrument by broadcasting an FDC3 fdc3.instrument context via the ViewChart intent, targeting the Chart panel."
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const ticker = String(fd.get('ticker') || 'AAPL');
          const timeframe = fd.get('timeframe') ? String(fd.get('timeframe')) : undefined;
          const chartType = fd.get('chartType') ? String(fd.get('chartType')) : undefined;
          await executeTool('viewChart', { ticker, timeframe, chartType });
        }}
      >
        <input
          name="ticker"
          type="text"
          required
          // @ts-expect-error declarative WebMCP attributes
          toolparamdescription="Ticker symbol or company name (e.g. AAPL, NVDA, TSLA, EUR/USD)"
        />
        <select name="timeframe">
          <option value="1D">1D</option>
          <option value="1W">1W</option>
          <option value="1M">1M</option>
          <option value="3M">3M</option>
          <option value="1Y">1Y</option>
        </select>
        <select name="chartType">
          <option value="candle">candle</option>
          <option value="line">line</option>
        </select>
        <button type="submit">View Chart</button>
      </form>

      {/* 7. addToWatchlist tool */}
      <form
        // @ts-expect-error declarative WebMCP attributes
        toolname="addToWatchlist"
        tooldescription="Adds a stock or financial instrument to the user's Watchlist panel by broadcasting an FDC3 AddWatchlist intent. Example: 'add COIN to my watchlist'."
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const ticker = String(fd.get('ticker') || 'COIN');
          const companyName = fd.get('companyName') ? String(fd.get('companyName')) : undefined;
          await executeTool('addToWatchlist', { ticker, companyName });
        }}
      >
        <input name="ticker" type="text" required />
        <input name="companyName" type="text" />
        <button type="submit">Add to Watchlist</button>
      </form>

      {/* 8. removeFromWatchlist tool */}
      <form
        // @ts-expect-error declarative WebMCP attributes
        toolname="removeFromWatchlist"
        tooldescription="Removes a stock or financial instrument from the user's Watchlist panel by broadcasting an FDC3 RemoveWatchlist intent. Example: 'remove TSLA from my watchlist'."
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const ticker = String(fd.get('ticker') || 'TSLA');
          await executeTool('removeFromWatchlist', { ticker });
        }}
      >
        <input name="ticker" type="text" required />
        <button type="submit">Remove from Watchlist</button>
      </form>

      {/* 9. cancelOrder tool */}
      <form
        // @ts-expect-error declarative WebMCP attributes
        toolname="cancelOrder"
        tooldescription="Cancels an active or pending order on the Orders Blotter by broadcasting an FDC3 CancelOrder intent. You can specify a ticker symbol or order ID."
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const ticker = fd.get('ticker') ? String(fd.get('ticker')) : undefined;
          const orderId = fd.get('orderId') ? String(fd.get('orderId')) : undefined;
          await executeTool('cancelOrder', { ticker, orderId });
        }}
      >
        <input name="ticker" type="text" />
        <input name="orderId" type="text" />
        <button type="submit">Cancel Order</button>
      </form>

      {/* 10. getPositions tool */}
      <form
        // @ts-expect-error declarative WebMCP attributes
        toolname="getPositions"
        tooldescription="Retrieves current portfolio positions, share quantities, weighted average entry costs, live market values, unrealized P&L, and portfolio exposure percentages across all held instruments."
        onSubmit={async (e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const ticker = fd.get('ticker') ? String(fd.get('ticker')) : undefined;
          await executeTool('getPositions', { ticker });
        }}
      >
        <input name="ticker" type="text" />
        <button type="submit">Get Positions</button>
      </form>

      {/* 11. getAccountSummary tool */}
      <form
        // @ts-expect-error declarative WebMCP attributes
        toolname="getAccountSummary"
        tooldescription="Retrieves overall account balance and financial health metrics including net liquidity / total equity, cash balance, realized P&L, unrealized P&L, day trading buying power, and margin buffer ratio."
        onSubmit={async (e) => {
          e.preventDefault();
          await executeTool('getAccountSummary', {});
        }}
      >
        <button type="submit">Get Account Summary</button>
      </form>
    </div>
  );
};
