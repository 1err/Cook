import { describe, expect, it, vi } from 'vitest';
import { RecipePager } from './recipePager';
import type { RecipePage } from '@cooking/shared';
const page = (id: string, next_cursor: string | null = null): RecipePage => ({items: [{id, title:id, ingredient_count:0, step_count:0, already_saved:false}], next_cursor});
describe('recipe pager ownership', () => {
  it('does not load subsequent pages automatically and deduplicates concurrent edits', async () => {
    const load = vi.fn().mockResolvedValueOnce(page('a','next')).mockResolvedValueOnce({items: [...page('a').items,...page('b').items],next_cursor:null});
    const pager = new RecipePager(load);
    await pager.refresh();
    expect(load).toHaveBeenCalledTimes(1);
    await pager.more();
    expect(pager.state.items.map(x => x.id)).toEqual(['a','b']);
  });
  it('discards old next-page results after refresh and permits retry after failure', async () => {
    let resolve!: (p: RecipePage) => void;
    const load = vi.fn().mockResolvedValueOnce(page('a','next')).mockImplementationOnce(() => new Promise<RecipePage>(r => {resolve=r;})).mockResolvedValueOnce(page('new','new-next')).mockRejectedValueOnce(new Error('retry')).mockResolvedValueOnce(page('last'));
    const pager = new RecipePager(load);
    await pager.refresh();
    const old = pager.more();
    await pager.refresh();
    resolve(page('stale'));
    await old;
    expect(pager.state.items.map(x => x.id)).toEqual(['new']);
    await pager.more();
    expect(pager.state.error).toBe('retry');
    await pager.more();
    expect(pager.state.items.map(x => x.id)).toEqual(['new','last']);
  });
});
