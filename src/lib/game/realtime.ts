import type { PublicGameState } from '$lib/game/types';

const DEFAULT_WS_PORT = 24678;
const RECONNECT_DELAY_MS = 1200;

type RealtimeMessage =
  | { type: 'game_state'; game: PublicGameState; viewerPlayerId?: string }
  | { type: 'error'; error: string };

export type LiveStatus = 'connecting' | 'connected' | 'disconnected';

type RealtimeClientOptions = {
  gameId: string;
  getPlayerId: () => string;
  onGameState: (game: PublicGameState, viewerPlayerId?: string) => void;
  onError: (message: string) => void;
  onStatusChange: (status: LiveStatus) => void;
};

export type RealtimeClient = {
  connect: () => void;
  subscribe: (playerId: string) => void;
  dispose: () => void;
};

function websocketUrl() {
  const configuredUrl = import.meta.env.VITE_COUP_WS_URL?.trim();
  if (configuredUrl) {
    return configuredUrl;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
  const configuredPort = Number.parseInt(import.meta.env.VITE_COUP_WS_PORT ?? '', 10);
  if (Number.isFinite(configuredPort) && configuredPort > 0) {
    return `${protocol}://${window.location.hostname}:${configuredPort}`;
  }

  if (import.meta.env.DEV) {
    return `${protocol}://${window.location.hostname}:${DEFAULT_WS_PORT}`;
  }

  return `${protocol}://${window.location.host}`;
}

function parseRealtimeMessage(eventData: string) {
  try {
    const payload = JSON.parse(eventData) as RealtimeMessage;
    if (payload.type !== 'game_state' && payload.type !== 'error') {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  let socket: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let suspendedForHiddenDocument = false;

  const scheduleReconnect = () => {
    if (disposed || reconnectTimer || suspendedForHiddenDocument) {
      return;
    }

    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, RECONNECT_DELAY_MS);
  };

  const subscribe = (playerId: string) => {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(
      JSON.stringify({
        type: 'subscribe',
        gameId: options.gameId,
        playerId: playerId || undefined
      })
    );
  };

  const connect = () => {
    if (disposed) {
      return;
    }
    if (typeof document !== 'undefined' && document.hidden) {
      suspendedForHiddenDocument = true;
      options.onStatusChange('disconnected');
      return;
    }

    suspendedForHiddenDocument = false;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      return;
    }

    options.onStatusChange('connecting');
    const nextSocket = new WebSocket(websocketUrl());
    socket = nextSocket;

    nextSocket.addEventListener('open', () => {
      if (socket !== nextSocket) {
        return;
      }

      options.onStatusChange('connected');
      subscribe(options.getPlayerId());
    });

    nextSocket.addEventListener('message', (event) => {
      if (socket !== nextSocket || typeof event.data !== 'string') {
        return;
      }

      const payload = parseRealtimeMessage(event.data);
      if (!payload) {
        options.onError('Invalid realtime message.');
        return;
      }

      if (payload.type === 'error') {
        options.onError(payload.error);
        return;
      }

      options.onGameState(payload.game, payload.viewerPlayerId);
    });

    nextSocket.addEventListener('close', () => {
      if (socket === nextSocket) {
        socket = null;
      }
      options.onStatusChange('disconnected');
      scheduleReconnect();
    });

    nextSocket.addEventListener('error', () => {
      nextSocket.close();
    });
  };

  const handleVisibilityChange = () => {
    if (typeof document === 'undefined') {
      return;
    }

    if (document.hidden) {
      suspendedForHiddenDocument = true;
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (socket) {
        const activeSocket = socket;
        socket = null;
        activeSocket.close();
      } else {
        options.onStatusChange('disconnected');
      }
      return;
    }

    suspendedForHiddenDocument = false;
    connect();
  };

  const handleOffline = () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (socket) {
      const activeSocket = socket;
      socket = null;
      activeSocket.close();
    }

    options.onStatusChange('disconnected');
  };

  const handleOnline = () => {
    if (typeof document !== 'undefined' && document.hidden) {
      return;
    }

    connect();
  };

  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange);
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);
  }

  const dispose = () => {
    disposed = true;
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    }
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    socket?.close();
    socket = null;
  };

  return { connect, subscribe, dispose };
}
