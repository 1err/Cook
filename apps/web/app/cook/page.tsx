import { PageShell } from "../components/PageShell";
import { RequireAuth } from "../components/RequireAuth";
import { CookScreen } from "./CookScreen";

export default function CookPage() {
  return (
    <RequireAuth>
      <PageShell>
        <CookScreen />
      </PageShell>
    </RequireAuth>
  );
}
