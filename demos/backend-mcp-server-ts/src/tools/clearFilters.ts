import { AppIdentifier, Context } from '@finos/fdc3';
import { createFdc3RaiseIntentResource } from '@mcp-fdc3/server/dist/mcp-fdc3-server.esm.js';
import { tickerMappingData } from '../mock-data/index.js';

export const clearFilters = async (_args: Record<string, never>): Promise<any> => {
    console.log('[clearFilters] Broadcasting ClearFilter intent to all panels');

    // We broadcast using a special fdc3.clear context and ClearFilter intent.
    // All demo apps listen for this intent and wipe their active FDC3 filter.
    const targetApp: AppIdentifier = { appId: 'all' };
    const context: Context = { type: 'fdc3.clear' };
    const fdc3Resource = createFdc3RaiseIntentResource('ClearFilter', context, targetApp);

    return {
        content: [
            { type: 'text', text: 'Filters cleared across all panels.' },
            fdc3Resource,
        ],
    };
};
