import type { RecipeSummary } from "@cooking/shared";

/** One user-requested page at a time; refresh/dispose invalidate all older work. */
export class RecipePager<T extends RecipeSummary = RecipeSummary> {
  state: { items: T[]; total?: number; next: string | null; loading: boolean; error: string | null } = { items: [], next: null, loading: true, error: null };
  private generation = 0;
  private listeners = new Set<() => void>();
  constructor(private fetchPage: (cursor?: string | null) => Promise<{ items: T[]; next_cursor: string | null; total_count?: number }>) {}
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: typeof this.state) { this.state = next; this.listeners.forEach(listener => listener()); }
  dispose() { this.generation++; this.listeners.clear(); }
  refresh = async () => { const generation = ++this.generation; return this.load(null, generation); };
  more = async () => { if (!this.state.loading && this.state.next) await this.load(this.state.next, this.generation); };
  private async load(cursor: string | null, generation: number) {
    this.publish({ ...this.state, loading: true, error: null });
    try {
      const page = await this.fetchPage(cursor);
      if (generation !== this.generation) return false;
      const merged = new Map((cursor ? this.state.items : []).map(item => [item.id, item]));
      page.items.forEach(item => merged.set(item.id, item));
      this.publish({ items: [...merged.values()], next: page.next_cursor, loading: false, error: null, ...(typeof page.total_count === "number" ? {total: page.total_count} : {}) });
      return true;
    } catch (error) {
      if (generation === this.generation) this.publish({ ...this.state, loading: false, error: error instanceof Error ? error.message : "Could not load recipes" });
      return false;
    }
  }
}
