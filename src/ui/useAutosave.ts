import { useCallback, useEffect, useRef, useState } from 'react';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** Debounced autosave. `queue(v)` schedules a save; pending work is flushed on unmount/page hide. */
export function useAutosave<T>(save: (v: T) => Promise<void>, delay = 700) {
  const [state, setState] = useState<SaveState>('idle');
  const [error, setError] = useState('');
  const pending = useRef<{ v: T } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const saveRef = useRef(save);
  saveRef.current = save;

  const flush = useCallback(async () => {
    clearTimeout(timer.current);
    const job = pending.current;
    if (!job) return;
    pending.current = null;
    setState('saving');
    try {
      await saveRef.current(job.v);
      setState(pending.current ? 'saving' : 'saved');
      setError('');
    } catch (e) {
      setState('error');
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const queue = useCallback(
    (v: T) => {
      pending.current = { v };
      setState('saving');
      clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), delay);
    },
    [delay, flush],
  );

  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    pending.current = null;
    setState('idle');
  }, []);

  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    window.addEventListener('beforeunload', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      window.removeEventListener('beforeunload', onHide);
      void flush();
    };
  }, [flush]);

  return { state, error, queue, flush, cancel };
}
