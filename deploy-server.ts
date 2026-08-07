const host = process.env.HOST || '0.0.0.0';
const publicPort = Number.parseInt(process.env.PORT || '80', 10);
const appPort = Number.parseInt(process.env.COUP_APP_PORT || '3000', 10);
const wsPort = Number.parseInt(process.env.COUP_WS_PORT || '24678', 10);

let shuttingDown = false;

const app = Bun.spawn([process.execPath, 'build/index.js'], {
  env: {
    ...process.env,
    HOST: '127.0.0.1',
    PORT: String(appPort),
    COUP_WS_PORT: String(wsPort)
  },
  stdout: 'inherit',
  stderr: 'inherit'
});

app.exited.then((code) => {
  if (shuttingDown) return;
  console.error(`SvelteKit server exited with ${code}.`);
  process.exit(code || 1);
});

type WebsocketState = {
  upstreamUrl: string;
  upstream?: WebSocket;
  queue: Array<string | ArrayBufferLike | Uint8Array>;
};

const server = Bun.serve<WebsocketState>({
  hostname: host,
  port: publicPort,
  async fetch(request, server) {
    const url = new URL(request.url);

    if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
      const upgraded = server.upgrade(request, {
        data: {
          upstreamUrl: `ws://127.0.0.1:${wsPort}${url.pathname}${url.search}`,
          queue: []
        }
      });

      return upgraded ? undefined : new Response('WebSocket upgrade failed.', { status: 400 });
    }

    const headers = new Headers(request.headers);
    headers.set('accept-encoding', 'identity');

    return fetch(`http://127.0.0.1:${appPort}${url.pathname}${url.search}`, {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual'
    });
  },
  websocket: {
    open(socket) {
      const upstream = new WebSocket(socket.data.upstreamUrl);
      socket.data.upstream = upstream;

      upstream.addEventListener('open', () => {
        for (const message of socket.data.queue) {
          upstream.send(message);
        }
        socket.data.queue = [];
      });

      upstream.addEventListener('message', (event) => {
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(event.data);
        }
      });

      upstream.addEventListener('close', () => {
        socket.close();
      });

      upstream.addEventListener('error', () => {
        socket.close(1011, 'Upstream websocket error.');
      });
    },
    message(socket, message) {
      const upstream = socket.data.upstream;

      if (upstream?.readyState === WebSocket.OPEN) {
        upstream.send(message);
        return;
      }

      socket.data.queue.push(message);
    },
    close(socket) {
      socket.data.upstream?.close();
    }
  }
});

console.log(`Listening on http://${host}:${publicPort}`);

function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;

  server.stop(true);
  app.kill(signal);

  setTimeout(() => {
    app.kill('SIGKILL');
    process.exit(0);
  }, 5_000).unref();
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
