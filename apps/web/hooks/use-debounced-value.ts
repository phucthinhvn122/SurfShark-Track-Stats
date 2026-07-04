// apps/web/hooks/use-debounced-value.ts
'use client';
import { useEffect, useState } from 'react';

/** Debounces a value so fast-changing input (e.g. search boxes) only
 *  triggers downstream effects (e.g. queries) after the user pauses. */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}
