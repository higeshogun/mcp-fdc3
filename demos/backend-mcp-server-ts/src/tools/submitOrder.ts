import { z } from 'zod';
import { resolveTicker } from '../mock-data/index.js';
import { createFdc3RaiseIntentResource } from '@mcp-fdc3/server/dist/mcp-fdc3-server.esm.js';

export const submitOrderDefinition = {
    name: 'submitOrder',
    description: 'Stages a UI mock order in the Order Ticket app. You MUST populate both orderType and price if the user provides a limit price! This is a UI automation test ONLY - no real financial trades occur.',
    parameters: z.object({
        side: z.enum(['buy', 'sell']).describe('The side of the order (buy or sell)'),
        quantity: z.number().describe('The number of shares/contracts to trade'),
        ticker: z.string().describe('The ticker symbol, e.g., AAPL, MSFT'),
        orderType: z.enum(['market', 'limit']).optional().default('market').describe('The type of order (market or limit). If the user mentions a price, this MUST be set to "limit"'),
        price: z.number().optional().describe('The mock limit price to populate in the UI field. You MUST extract and provide this number if the user mentions a price.'),
    })
};

export async function submitOrder(args: z.infer<typeof submitOrderDefinition.parameters>) {
    const resolvedTicker = resolveTicker(args.ticker);

    if (!resolvedTicker) {
        return {
            content: [{
                type: 'text',
                text: `Error: Could not resolve a valid trading ticker for "${args.ticker}". Please verify the symbol or company name. If unsure, ask the user to clarify.`
            }],
            isError: true
        };
    }

    // Generate an FDC3 RaiseIntent resource directing the UI to open the Order Ticket
    const context = {
        type: 'fdc3.order',
        details: {
            ticker: resolvedTicker,
            side: args.side,
            quantity: args.quantity,
            type: args.orderType,
            price: args.price
        }
    };

    // Create MCP resource so it reaches the frontend chat client
    const fdc3Resource = createFdc3RaiseIntentResource('SubmitOrder', context as any, { appId: 'frontend-app-order-ticket' });

    const orderDesc = args.orderType === 'limit' && args.price
        ? `LIMIT ${args.side.toUpperCase()} ${args.quantity} ${resolvedTicker} @ ${args.price}`
        : `MARKET ${args.side.toUpperCase()} ${args.quantity} ${resolvedTicker}`;

    return {
        content: [
            {
                type: 'text',
                text: `Order staged in the UI for ${orderDesc} via an FDC3 SubmitOrder intent. The Order Ticket app has been populated but the trade is NOT yet executed. Instruct the user that they must manually review and confirm the execution in their Order Ticket panel.`
            },
            fdc3Resource
        ]
    };
}
