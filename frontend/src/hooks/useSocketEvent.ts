import { useEffect, useRef } from 'react';
import { getSocket } from '@/lib/socket';

/**
 * Subscribe to a socket event for the lifetime of a component. Waits for the
 * socket to exist (pages can mount before the app has connected) and always
 * calls the latest handler without re-subscribing on every render.
 */
export function useSocketEvent<T>(event: string, handler: (data: T) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let detach: (() => void) | undefined;
    const listener = (data: T) => handlerRef.current(data);

    const attach = () => {
      const socket = getSocket();
      if (!socket) {
        timer = setTimeout(attach, 300);
        return;
      }
      socket.on(event, listener);
      detach = () => socket.off(event, listener);
    };
    attach();

    return () => {
      clearTimeout(timer);
      detach?.();
    };
  }, [event]);
}
