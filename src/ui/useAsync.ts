import { useCallback, useEffect, useRef, useState } from 'react';

export interface AsyncState<T> {
  data: T | undefined;
  error: string;
  loading: boolean;
}

/** Run an async loader on mount (and on `reload`). Ignores results from stale or unmounted calls. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> & { reload: () => void } {
  const [state, setState] = useState<AsyncState<T>>({ data: undefined, error: '', loading: true });
  const run = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  const reload = useCallback(() => {
    const id = ++run.current;
    setState((s) => ({ ...s, loading: true, error: '' }));
    fnRef.current().then(
      (data) => id === run.current && setState({ data, error: '', loading: false }),
      (e: unknown) =>
        id === run.current && setState({ data: undefined, error: e instanceof Error ? e.message : String(e), loading: false }),
    );
  }, []);

  useEffect(() => {
    reload();
    return () => {
      run.current++;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload };
}
