export const tickerMappingData = [
  {
    name: 'Alphabet Inc',
    ticker: 'GOOGL'
  },
  {
    name: 'Amazon.com, Inc',
    ticker: 'AMZN'
  },
  {
    name: 'Apple Inc',
    ticker: 'AAPL'
  },
  {
    name: 'Facebook',
    ticker: 'META'
  },
  {
    name: 'Google',
    ticker: 'GOOGL'
  },
  {
    name: 'Meta Platforms, Inc',
    ticker: 'META'
  },
  {
    name: 'Microsoft Corp',
    ticker: 'MSFT'
  },
  {
    name: 'Nvidia Corp',
    ticker: 'NVDA'
  },
  {
    name: 'Tesla Inc',
    ticker: 'TSLA'
  },
  {
    name: 'JPMorgan Chase & Co',
    ticker: 'JPM'
  },
  {
    name: 'Goldman Sachs Group',
    ticker: 'GS'
  },
  {
    name: 'Visa Inc',
    ticker: 'V'
  },
  {
    name: 'Eli Lilly & Co',
    ticker: 'LLY'
  },
  {
    name: 'Netflix Inc',
    ticker: 'NFLX'
  }
];

export const fxMappingData: Record<string, string> = {
  'EUR/USD': 'EUR/USD',
  'EURUSD': 'EUR/USD',
  'GBP/USD': 'GBP/USD',
  'GBPUSD': 'GBP/USD',
  'USD/JPY': 'USD/JPY',
  'USDJPY': 'USD/JPY',
  'EURO DOLLAR': 'EUR/USD',
  'CABLE': 'GBP/USD',
  'POUND DOLLAR': 'GBP/USD'
};

const tickerMapUpper = new Map<string, string>();

tickerMappingData.forEach((item) => {
  tickerMapUpper.set(item.name.toUpperCase(), item.ticker);
  tickerMapUpper.set(item.ticker.toUpperCase(), item.ticker);
});

for (const [key, ticker] of Object.entries(fxMappingData)) {
  tickerMapUpper.set(key.toUpperCase(), ticker);
}

export function resolveTicker(input: string): string | null {
  const upperInput = input.trim().toUpperCase();
  return tickerMapUpper.get(upperInput) || null;
}
