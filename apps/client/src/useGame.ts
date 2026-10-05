import { useCallback, useEffect, useRef, useState } from 'react';
import type { Snapshot } from '../../../packages/shared/types';
export interface Reaction {
  playerId: string;
  emoji: string;
  at: number;
}
export function useGame(role: 'host' | 'player') {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null),
    [connected, setConnected] = useState(false),
    [error, setError] = useState(''),
    [reactions, setReactions] = useState<Reaction[]>([]),
    [now, setNow] = useState(Date.now());
  const ws = useRef<WebSocket | null>(null),
    offset = useRef(0);
  useEffect(() => {
    let stopped = false,
      retry: ReturnType<typeof setTimeout>;
    const connect = () => {
      const socket = new WebSocket(
        `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`,
      );
      ws.current = socket;
      socket.onopen = () => {
        setConnected(true);
        setError('');
        socket.send(
          JSON.stringify({
            type: 'game.connection.hello',
            payload: {
              role,
              token: localStorage.getItem('midnight-player-token') ?? undefined,
              hostKey: sessionStorage.getItem('midnight-host-key') ?? undefined,
            },
          }),
        );
      };
      socket.onmessage = (event) => {
        const data = JSON.parse(event.data);
        offset.current = data.serverTime - Date.now();
        if (data.type === 'game.player.identity') {
          localStorage.setItem('midnight-player-token', data.payload.token);
          return;
        }
        if (data.type === 'game.player.kicked') {
          localStorage.removeItem('midnight-player-token');
          setError(data.payload.message);
          return;
        }
        if (data.type === 'game.error') {
          setError(data.payload.message);
          return;
        }
        if (data.type === 'game.emoji.sent') {
          setReactions((old) => [
            ...old.filter((r) => Date.now() - r.at < 2400),
            { ...data.payload, at: Date.now() },
          ]);
          return;
        }
        if (data.payload?.state) setSnapshot(data.payload);
      };
      socket.onclose = () => {
        setConnected(false);
        if (!stopped) retry = setTimeout(connect, 1500);
      };
    };
    connect();
    const timer = setInterval(() => setNow(Date.now() + offset.current), 100);
    return () => {
      stopped = true;
      clearTimeout(retry);
      clearInterval(timer);
      ws.current?.close();
    };
  }, [role]);
  const send = useCallback((type: string, payload: unknown = {}) => {
    if (ws.current?.readyState !== WebSocket.OPEN) {
      setError('Connection lost. Reconnecting…');
      return;
    }
    setError('');
    ws.current.send(JSON.stringify({ type, payload }));
  }, []);
  return { snapshot, connected, error, setError, send, now, reactions };
}
export type GameConnection = ReturnType<typeof useGame>;
