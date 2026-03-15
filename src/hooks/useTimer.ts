import { useRef, useCallback } from 'react';

export function useTimer() {
  const ref = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (ref.current !== null) {
      clearTimeout(ref.current);
      ref.current = null;
    }
  }, []);

  const set = useCallback((fn: () => void, ms: number) => {
    clear();
    ref.current = setTimeout(() => {
      ref.current = null;
      fn();
    }, ms);
  }, [clear]);

  return { set, clear };
}
