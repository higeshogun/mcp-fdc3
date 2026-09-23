import { z } from 'zod';
import { resolveTicker } from '../mock-data/index.js';
import { createFdc3RaiseIntentResource } from '@mcp-fdc3/server/dist/mcp-fdc3-server.esm.js';

export const stageOrderDefinition = {
    name: 'stageOrder',
    description: 'Stages and populates an order in the Order Ticket UI without executing it, allowing the trader to review, edit, or confirm quantities, side, and prices before manual submission. Use this when the user asks to stage, prepare, draft, or set up an order (e.g., "Stage an order to buy 100 AAPL", "Prepare a limit buy for 50 TSLA at 240 in the ticket", "Set up an order to sell 20 MSFT", "Stage 100 NVDA").',
    parameters: z.object({
        ticker: z.string().describe('The ticker symbol or company name, e.g., AAPL, MSFT, NVDA, TSLA'),
        side: z.enum(['buy', 'sell']).optional().default('buy').describe('The side of the order (buy or sell)'),
        quantity: z.number().optional().default(100).describe('The number of shares/contracts to stage'),
        orderType: z.enum(['market', 'limit']).optional().default('market').describe('The type of order (market or limit)'),
        price: z.number().optional().describe('Optional limit price for limit orders'),
    })
};

export async function stageOrder(args: z.infer<typeof stageOrderDefinition.parameters>) {
    const resolvedTicker = resolveTicker(args.ticker) || args.ticker.toUpperCase();

    const today = new Date();
    const dateStr = today.toISOString().split('T')[0];
    const timeStr = today.toLocaleTimeString('en-US', { hour12: false });
    const orderId = `S${Math.floor(1000 + Math.random() * 9000)}`;

    const side = args.side || 'buy';
    const quantity = args.quantity || 100;
    const orderType = args.orderType || 'market';
    const price = args.price;

    const context = {
        type: 'fdc3.order',
        details: {
            orderId,
            ticker: resolvedTicker,
            side,
            quantity,
            type: orderType,
            price,
            execute: false,
            time: `${dateStr} ${timeStr}`,
        }
    };

    const fdc3Resource = createFdc3RaiseIntentResource('StageOrder', context as any, { appId: 'frontend-app-order-ticket' });

    const orderDesc = orderType === 'limit' && price
        ? `LIMIT ${side.toUpperCase()} ${quantity} ${resolvedTicker} @ $${price}`
        : `MARKET ${side.toUpperCase()} ${quantity} ${resolvedTicker}`;

    return {
        content: [
            {
                type: 'text',
                text: `Order staged in Order Ticket for ${orderDesc} via FDC3 StageOrder intent. The ticket has been populated and is ready for manual review and confirmation.`
            },
            fdc3Resource
        ]
    };
}
