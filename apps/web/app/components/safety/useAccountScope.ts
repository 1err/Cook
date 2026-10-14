"use client";

import { useEffect, useRef } from "react";
import { useAuth } from "../../lib/auth";
import { getAuthGeneration } from "../../lib/userStorage";

export type AccountActor = { id: string; generation: number };

/** Capture the visible account before confirmation; discard results after a switch. */
export function useAccountScope() {
  const { user } = useAuth();
  const accountId = user?.id ?? null;
  const currentId = useRef(accountId);
  currentId.current = accountId;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  return {
    accountId,
    capture: (): AccountActor | null => accountId ? { id: accountId, generation: getAuthGeneration() } : null,
    isCurrent: (actor: AccountActor) => currentId.current === actor.id && getAuthGeneration() === actor.generation,
    active: (actor: AccountActor) => mounted.current && currentId.current === actor.id && getAuthGeneration() === actor.generation,
  };
}
