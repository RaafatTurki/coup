import { building } from '$app/environment';
import { WebSocket, WebSocketServer } from 'ws';
import type { GameState, PublicGameState } from '$lib/game/types';
import { getGame, heartbeatPlayer } from '$lib/server/coup-store';
import { getPublicGameState } from '$lib/server/coup-public';

const DEFAULT_WS_PORT = 24678;
const HEARTBEAT_INTERVAL_MS = 3_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

type SubscribeMessage = {
  type: 'subscribe';
  gameId?: string;
  playerId?: string;
};

type OutboundMessage =
  | { type: 'game_state'; game: PublicGameState; viewerPlayerId?: string }
  | { type: 'error'; error: string };

type ClientState = {
  gameId: string;
  playerId: string;
  lastPongAt: number;
};

type RealtimeState = {
  wss: WebSocketServer;
  clients: Map<WebSocket, ClientState>;
};

const globalRealtime = globalThis as typeof globalThis & {
  __RT?: RealtimeState | null;
};

function normalizePort(rawValue: string | undefined): number {
  const parsed = Number.parseInt(rawValue ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_WS_PORT;
}

function normalizeGameId(rawGameId: string | undefined): string {
  return (rawGameId ?? '').trim().toUpperCase();
}

function normalizePlayerId(rawPlayerId: string | undefined): string {
  return (rawPlayerId ?? '').trim();
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected realtime error.';
}

function parseClientMessage(rawPayload: string): SubscribeMessage | null {
  try {
    const payload = JSON.parse(rawPayload) as Partial<SubscribeMessage>;
    if (payload.type !== 'subscribe') return null;
    return {
      type: 'subscribe',
      gameId: typeof payload.gameId === 'string' ? payload.gameId : undefined,
      playerId: typeof payload.playerId === 'string' ? payload.playerId : undefined
    };
  } catch {
    return null;
  }
}

function sendJson(socket: WebSocket, payload: OutboundMessage): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }

  socket.send(JSON.stringify(payload));
}

function sendSnapshot(socket: WebSocket, gameId: string, playerId: string): void {
  try {
    const viewerPlayerId = playerId || undefined;
    const game = getGame(gameId);
    sendJson(socket, {
      type: 'game_state',
      game: getPublicGameState(game, viewerPlayerId, connectedPlayerIdsForGame(ensureRealtimeState(), gameId)),
      viewerPlayerId
    });
  } catch (error) {
    sendJson(socket, {
      type: 'error',
      error: messageFromError(error)
    });
  }
}

function broadcastToSubscribers(state: RealtimeState, game: GameState): void {
  const connectedPlayerIds = connectedPlayerIdsForGame(state, game.id);

  for (const [socket, client] of state.clients.entries()) {
    if (socket.readyState !== WebSocket.OPEN) {
      state.clients.delete(socket);
      continue;
    }

    if (client.gameId !== game.id) {
      continue;
    }

    const viewerPlayerId = client.playerId || undefined;
    sendJson(socket, {
      type: 'game_state',
      game: getPublicGameState(game, viewerPlayerId, connectedPlayerIds),
      viewerPlayerId
    });
  }
}

function connectedPlayerIdsForGame(state: RealtimeState | null, gameId: string): Set<string> {
  if (!state) {
    return new Set();
  }

  const connectedPlayerIds = new Set<string>();

  for (const [socket, client] of state.clients.entries()) {
    if (socket.readyState !== WebSocket.OPEN || client.gameId !== gameId || !client.playerId) {
      continue;
    }

    connectedPlayerIds.add(client.playerId);
  }

  return connectedPlayerIds;
}

function broadcastGameStateById(state: RealtimeState, gameId: string): void {
  if (!gameId) {
    return;
  }

  try {
    broadcastToSubscribers(state, getGame(gameId));
  } catch {
    // Ignore missing games during disconnect cleanup.
  }
}

function runHeartbeat(state: RealtimeState): void {
  const now = Date.now();

  for (const [socket, client] of state.clients.entries()) {
    if (socket.readyState !== WebSocket.OPEN) {
      const gameId = client.gameId;
      state.clients.delete(socket);
      broadcastGameStateById(state, gameId);
      continue;
    }

    if (now - client.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
      const gameId = client.gameId;
      state.clients.delete(socket);
      socket.terminate();
      broadcastGameStateById(state, gameId);
      continue;
    }

    socket.ping();

    if (!client.gameId || !client.playerId) {
      continue;
    }

    try {
      heartbeatPlayer(client.gameId, client.playerId);
    } catch (error) {
      sendJson(socket, {
        type: 'error',
        error: messageFromError(error)
      });
    }
  }
}

function createRealtimeState(): RealtimeState | null {
  const port = normalizePort(process.env.COUP_WS_PORT ?? process.env.VITE_COUP_WS_PORT);

  try {
    const wss = new WebSocketServer({ port });
    const clients = new Map<WebSocket, ClientState>();
    let state!: RealtimeState;
    const heartbeatTimer = setInterval(() => runHeartbeat(state), HEARTBEAT_INTERVAL_MS);
    heartbeatTimer.unref?.();
    state = { wss, clients };

    wss.on('connection', (socket) => {
      clients.set(socket, { gameId: '', playerId: '', lastPongAt: Date.now() });

      socket.on('pong', () => {
        const client = clients.get(socket);
        if (client) {
          client.lastPongAt = Date.now();
        }
      });

      socket.on('message', (rawMessage, isBinary) => {
        if (isBinary) {
          sendJson(socket, { type: 'error', error: 'Binary payloads are not supported.' });
          return;
        }

        const message = parseClientMessage(rawMessage.toString());
        if (!message) {
          sendJson(socket, { type: 'error', error: 'Invalid realtime message.' });
          return;
        }

        const gameId = normalizeGameId(message.gameId);
        if (!gameId) {
          sendJson(socket, { type: 'error', error: 'Game ID is required.' });
          return;
        }

        const client = clients.get(socket);
        if (!client) {
          return;
        }

        const previousGameId = client.gameId;
        const previousPlayerId = client.playerId;
        client.lastPongAt = Date.now();
        client.gameId = gameId;
        client.playerId = normalizePlayerId(message.playerId);
        sendSnapshot(socket, client.gameId, client.playerId);

        if (previousGameId && (previousGameId !== client.gameId || previousPlayerId !== client.playerId)) {
          broadcastGameStateById(state, previousGameId);
        }
        broadcastGameStateById(state, client.gameId);
      });

      const cleanup = () => {
        const client = clients.get(socket);
        const gameId = client?.gameId ?? '';
        clients.delete(socket);
        broadcastGameStateById(state, gameId);
      };
      socket.on('close', cleanup);
      socket.on('error', cleanup);
    });

    return state;
  } catch (error) {
    console.error(`Failed to start websocket server on port ${port}.`, error);
    return null;
  }
}

function ensureRealtimeState(): RealtimeState | null {
  if (building) {
    return null;
  }

  if (globalRealtime.__RT !== undefined) {
    return globalRealtime.__RT;
  }

  globalRealtime.__RT = createRealtimeState();
  return globalRealtime.__RT;
}

export function broadcastGameState(game: GameState): void {
  const state = ensureRealtimeState();
  if (!state) {
    return;
  }

  broadcastToSubscribers(state, getGame(game.id));
}

export function getConnectedPlayerIds(gameId: string): Set<string> {
  return connectedPlayerIdsForGame(ensureRealtimeState(), gameId);
}

void ensureRealtimeState();
