"use client";

import { RequireAuth } from "../../components/RequireAuth";
import { isAdminUser } from "../../lib/admin";
import { useAuth } from "../../lib/auth";
import { DesignSystemGallery } from "./DesignSystemGallery";

function GuardedGallery() {
  const { user } = useAuth();
  if (!isAdminUser(user)) return <main><h1>Not authorized</h1></main>;
  return <DesignSystemGallery />;
}

export default function DesignSystemPage() {
  return <RequireAuth><GuardedGallery /></RequireAuth>;
}
