'use client';

import { useState, useCallback } from 'react';
import { useToast } from './useToast';

/**
 * Wraps an async function with loading state and automatic error toasts.
 *
 * Usage:
 *   const { run, loading } = useAsyncAction(
 *     async (id: string) => fetch(`/api/workers/${id}`, { method: 'DELETE' }),
 *     { errorTitle: 'Remove failed' }
 *   );
 *   <button onClick={() => run(worker.id)} disabled={loading}>Remove</button>
 */
export function useAsyncAction<TArgs extends unknown[], TResult>(
  fn: (...args: TArgs) => Promise<TResult>,
  options?: {
    successTitle?: string;
    successMessage?: string;
    errorTitle?: string;
  },
) {
  const [loading, setLoading] = useState(false);
  const { addToast } = useToast();

  const run = useCallback(
    async (...args: TArgs): Promise<TResult | undefined> => {
      setLoading(true);
      try {
        const result = await fn(...args);
        if (options?.successMessage) {
          addToast({
            type: 'success',
            title: options.successTitle ?? 'Success',
            message: options.successMessage,
          });
        }
        return result;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Something went wrong';
        addToast({
          type: 'error',
          title: options?.errorTitle ?? 'Error',
          message,
        });
        return undefined;
      } finally {
        setLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [fn],
  );

  return { run, loading };
}
