"use client";
import { RequireAuth } from "../../components/RequireAuth";
import { useAuth } from "../../lib/auth";
import { isAdminUser } from "../../lib/admin";
import Dashboard from "./Dashboard";
function Guard() {
  const { user } = useAuth();
  return isAdminUser(user) ? (
    <Dashboard />
  ) : (
    <main style={{ padding: "3rem" }}>
      <h1>Administrator access required</h1>
      <p>This dashboard is only available to administrators.</p>
    </main>
  );
}
export default function Page() {
  return (
    <RequireAuth>
      <Guard />
    </RequireAuth>
  );
}
