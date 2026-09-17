import { loadConfig, type Config } from './config.ts';
import { isLoopbackHost } from './security.ts';
import { createServer } from './server.ts';

let config: Config;
try {
  config = loadConfig();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}

const server = createServer(config);

server.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(
      `Port ${config.port} is already in use. Is Orchboard already running? ` +
        'Set ORCHBOARD_PORT to use another port.',
    );
    process.exit(1);
  }
  throw error;
});

server.listen(config.port, config.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.port;
  const loopback = isLoopbackHost(config.host);

  console.log(`Orchboard running at http://${loopback ? 'localhost' : config.host}:${port}`);
  if (!loopback) {
    console.warn(
      `Warning: listening on ${config.host}. Anyone who can reach this address can use Orchboard.`,
    );
  }
});
