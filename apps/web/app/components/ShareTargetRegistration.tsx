"use client";

import { useEffect } from "react";
import { registerShareTarget } from "../lib/shareTarget";

export function ShareTargetRegistration() {
  useEffect(() => {
    void registerShareTarget().catch(() => {
      // Ordinary browsing and manual imports work without share-target support.
    });
  }, []);
  return null;
}
