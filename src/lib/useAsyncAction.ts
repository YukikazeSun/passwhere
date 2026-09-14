import { useCallback, useEffect, useRef, useState } from "react";

export const ACTION_BLOCKED = Symbol("action-blocked");

export async function runWithActionGate<T>(
  gate: { current: boolean },
  action: () => Promise<T>,
): Promise<T | typeof ACTION_BLOCKED> {
  if (gate.current) return ACTION_BLOCKED;
  gate.current = true;
  try {
    return await action();
  } finally {
    gate.current = false;
  }
}

export function useAsyncAction<ActionName extends string>() {
  const gateRef = useRef(false);
  const mountedRef = useRef(true);
  const [activeAction, setActiveAction] = useState<ActionName | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const runAction = useCallback(async <T,>(name: ActionName, action: () => Promise<T>) => {
    if (gateRef.current) return ACTION_BLOCKED;
    setActiveAction(name);
    try {
      return await runWithActionGate(gateRef, action);
    } finally {
      if (mountedRef.current) setActiveAction(null);
    }
  }, []);

  return { activeAction, busy: activeAction !== null, runAction };
}
