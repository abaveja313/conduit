import { ConduitServer } from './mcp/conduit-server';
import { WebWorkerServerTransport } from '@conduit/transports';
import { ErrorCodes } from '@conduit/shared';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport';

let server: ConduitServer | null = null;
let transport: Transport | null = null;

self.addEventListener('message', async (event) => {
    const { type } = event.data;

    switch (type) {
        case 'init':
            try {
                transport = new WebWorkerServerTransport();
                await transport.start();

                server = new ConduitServer({
                    name: 'conduit',
                    version: '1.0.0'
                });

                await server.initialize();
                await server.connect(transport);

                self.postMessage({ type: 'ready' });
            } catch (error) {
                self.postMessage({
                    type: 'error',
                    error: {
                        code: ErrorCodes.INTERNAL_ERROR,
                        message: error instanceof Error ? error.message : 'Failed to initialize',
                        data: { originalError: String(error) }
                    }
                });
            }
            break;

        case 'shutdown':
            server?.dispose();
            await transport?.close();
            server = null;
            transport = null;
            self.postMessage({ type: 'shutdown_complete' });
            break;
    }
});
