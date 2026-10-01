import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { RecipePage } from '@cooking/shared';
import LibraryPage from './page';
const { mine, catalog, query } = vi.hoisted(() => ({mine:vi.fn(),catalog:vi.fn(),query:{value:""}}));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 'account-a' } }) }));
vi.mock('next/navigation', () => ({useSearchParams: () => new URLSearchParams(query.value)}));
vi.mock('../components/RequireAuth', () => ({RequireAuth: ({children}: {children:ReactNode}) => <>{children}</>}));
vi.mock('../lib/i18n', async () => {
  const { MESSAGE_MAP } = await import('@cooking/shared');
  return {useT: () => (key:string, vars?: Record<string, string | number>) => key.startsWith('recipe.timing.') || key === 'recipe.totalTime.minutesSuffix'
    ? (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ''))
    : key, useI18n: () => ({language:'en'})};
});
vi.mock('../lib/api', () => ({apiFetch:vi.fn(),webApiClient:{recipes:{page:mine,catalogPage:catalog}}}));
const page = (id:string, next_cursor:string|null=null, already_saved=false):RecipePage => ({items:[{id,title:id,ingredient_count:0,step_count:0,already_saved}],next_cursor});
beforeEach(() => {query.value="";mine.mockReset();catalog.mockReset();vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});});
afterEach(() => {cleanup();vi.unstubAllGlobals();});

test('public cards use timing summaries and retain the independent copy action', async () => {
  query.value = 'view=public';
  mine.mockResolvedValue(page('Private recipe'));
  catalog.mockResolvedValue({ items: [{ ...page('Slow public recipe').items[0], total_time_minutes: 500,
    timing_summary: { hands_on_minutes: 20, passive_minutes: 480, is_estimate: false } }], next_cursor: null });
  const { apiFetch } = await import('../lib/api');
  vi.mocked(apiFetch).mockResolvedValue(new Response('{}'));
  render(<LibraryPage />);
  const heading = await screen.findByRole('heading', { name: 'Slow public recipe' });
  expect(screen.queryByText('20 min hands-on')).not.toBeInTheDocument();
  const timing = screen.getByRole('button', { name: 'Timing details: 8 hr 20 min' });
  expect(timing.closest('a')).toBeNull();
  fireEvent.focus(timing);
  expect(screen.getByText('20 min hands-on')).toBeVisible();
  expect(screen.getByText('8 hr passive')).toBeVisible();
  expect(heading.closest('a')).toHaveAttribute('href', '/library/public/Slow%20public%20recipe');
  const copy = screen.getByRole('button', { name: /^library.addToMyLibrary:/ });
  expect(copy.closest('a')).toBeNull();
  fireEvent.click(copy);
  expect(await screen.findByRole('button', { name: /^library.inYourLibrary:/ })).toHaveAttribute('aria-disabled', 'true');
  expect(apiFetch).toHaveBeenLastCalledWith('/recipes/catalog/Slow public recipe/copy', { method: 'POST' });
});

test('loads one page on demand, searches server-side, and uses per-row copy state without private-library scans', async () => {
  mine.mockResolvedValueOnce(page('First','next')).mockResolvedValueOnce(page('Later')).mockResolvedValueOnce(page('Needle'));
  catalog.mockResolvedValue(page('Public recipe',null,true));
  render(<LibraryPage />);
  expect(await screen.findByRole('heading',{name:'First'})).toBeVisible();
  expect(mine).toHaveBeenCalledTimes(1);
  expect(catalog).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'common.loadMoreRecipes'}));
  expect(await screen.findByRole('heading',{name:'Later'})).toBeVisible();
  expect(mine).toHaveBeenLastCalledWith({q:'',tags:[],cursor:'next'});
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Needle'}});
  expect(await screen.findByRole('heading',{name:'Needle'})).toBeVisible();
  expect(screen.queryByRole('heading',{name:'First'})).not.toBeInTheDocument();
  expect(mine).toHaveBeenLastCalledWith({q:'Needle',tags:[],cursor:null});
  fireEvent.click(screen.getByRole('tab',{name:'library.publicLibrary'}));
  expect(await screen.findByRole('button',{name:/^library.inYourLibrary:/})).toHaveAttribute('aria-disabled', 'true');
  expect(mine).toHaveBeenCalledTimes(3);
});

test('a delayed next page cannot repopulate a changed search', async () => {
  let resolve!:(value:RecipePage)=>void;
  mine.mockResolvedValueOnce(page('Old','next')).mockImplementationOnce(() => new Promise<RecipePage>(r => {resolve=r;})).mockResolvedValueOnce(page('New query'));
  render(<LibraryPage />);
  await screen.findByRole('heading',{name:'Old'});
  fireEvent.click(screen.getByRole('button',{name:'common.loadMoreRecipes'}));
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'New'}});
  await screen.findByRole('heading',{name:'New query'});
  await act(async () => resolve(page('Stale result')));
  expect(screen.queryByRole('heading',{name:'Stale result'})).not.toBeInTheDocument();
});

test('retains private recipes across a catalog failure and retries only the failed catalog', async () => {
  mine.mockResolvedValueOnce(page('My saved recipe')).mockRejectedValue(new Error('Private offline'));
  catalog.mockRejectedValueOnce(new Error('Catalog offline')).mockResolvedValueOnce(page('Recovered public recipe'));
  render(<LibraryPage />);
  await screen.findByRole('heading', { name: 'My saved recipe' });
  fireEvent.click(screen.getByRole('tab', { name: 'library.publicLibrary' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('library.loadErrorTitle');
  fireEvent.click(screen.getByRole('button', { name: 'library.retry' }));
  await screen.findByRole('heading', { name: 'Recovered public recipe' });
  fireEvent.click(screen.getByRole('tab', { name: 'library.myLibrary' }));
  expect(screen.getByRole('heading', { name: 'My saved recipe' })).toBeVisible();
  expect(mine).toHaveBeenCalledTimes(1);
  expect(catalog).toHaveBeenCalledTimes(2);
});

test('a catalog copy refreshes the retained private library', async () => {
  const { apiFetch } = await import('../lib/api');
  vi.mocked(apiFetch).mockResolvedValue(new Response('{}'));
  mine.mockResolvedValueOnce(page('Previously saved')).mockResolvedValueOnce(page('Newly copied'));
  catalog.mockResolvedValueOnce(page('Public recipe'));
  render(<LibraryPage />);
  await screen.findByRole('heading', { name: 'Previously saved' });
  fireEvent.click(screen.getByRole('tab', { name: 'library.publicLibrary' }));
  fireEvent.click(await screen.findByRole('button', { name: /^library.addToMyLibrary:/ }));
  await screen.findByRole('button', { name: /^library.inYourLibrary:/ });
  fireEvent.click(screen.getByRole('tab', { name: 'library.myLibrary' }));
  await screen.findByRole('heading', { name: 'Newly copied' });
});

test('a catalog copy completing after unmount cannot refresh another account', async () => {
  const { apiFetch } = await import('../lib/api');
  let finish!: (response: Response) => void;
  vi.mocked(apiFetch).mockImplementation(() => new Promise<Response>(resolve => { finish = resolve; }));
  mine.mockResolvedValue(page('Saved recipe'));
  catalog.mockResolvedValue(page('Public recipe'));
  const rendered = render(<LibraryPage />);
  await screen.findByRole('heading', { name: 'Saved recipe' });
  fireEvent.click(screen.getByRole('tab', { name: 'library.publicLibrary' }));
  fireEvent.click(await screen.findByRole('button', { name: /^library.addToMyLibrary:/ }));
  rendered.unmount();
  await act(async () => { finish(new Response('{}')); });
  expect(mine).toHaveBeenCalledTimes(1);
});


test('a public-library navigation link activates the paginated catalog immediately', async () => {
  query.value = 'view=public';
  mine.mockResolvedValue(page('Private recipe'));
  catalog.mockResolvedValue(page('Linked public recipe'));
  render(<LibraryPage />);
  expect(await screen.findByRole('heading', { name: 'Linked public recipe' })).toBeVisible();
  expect(screen.getByRole('tab', { name: 'library.publicLibrary' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByRole('heading', { name: 'Private recipe' })).not.toBeInTheDocument();
  expect(catalog).toHaveBeenCalledTimes(1);
});

test('opens public recipe details before copying, including recipes already saved', async () => {
  query.value = 'view=public';
  mine.mockResolvedValue(page('Private recipe'));
  catalog.mockResolvedValue(page('Public recipe', null, true));
  render(<LibraryPage />);

  const heading = await screen.findByRole('heading', { name: 'Public recipe' });
  expect(heading.closest('a')).toHaveAttribute('href', '/library/public/Public%20recipe');
  const copyButton = screen.getByRole('button', { name: /^library.inYourLibrary:/ });
  expect(copyButton).toHaveAttribute('aria-disabled', 'true');
  expect(copyButton.closest('a')).toBeNull();
});

test('bookmarks track simultaneous copies independently and prevent duplicate submissions', async () => {
  query.value = 'view=public';
  mine.mockResolvedValue(page('Private recipe'));
  catalog.mockResolvedValue({ items: [...page('First recipe').items, ...page('Second recipe').items], next_cursor: null });
  const { apiFetch } = await import('../lib/api');
  const pending = new Map<string, (response: Response) => void>();
  vi.mocked(apiFetch).mockReset().mockImplementation(url => new Promise<Response>(resolve => { pending.set(String(url), resolve); }));
  render(<LibraryPage />);
  const first = await screen.findByRole('button', { name: 'library.addToMyLibrary: First recipe' });
  const second = screen.getByRole('button', { name: 'library.addToMyLibrary: Second recipe' });
  first.focus();
  fireEvent.click(first);
  fireEvent.click(first);
  fireEvent.click(second);
  expect(apiFetch).toHaveBeenCalledTimes(2);
  expect(first).toHaveAttribute('aria-busy', 'true');
  expect(second).toHaveAttribute('aria-busy', 'true');
  await act(async () => { pending.get('/recipes/catalog/Second recipe/copy')!(new Response('{}')); });
  expect(first).toHaveAttribute('aria-busy', 'true');
  expect(second).toHaveAttribute('aria-busy', 'false');
  expect(second).toHaveAttribute('aria-label', 'library.inYourLibrary: Second recipe');
  await act(async () => { pending.get('/recipes/catalog/First recipe/copy')!(new Response('{}')); });
  expect(first).toHaveFocus();
  expect(first).toHaveAttribute('aria-label', 'library.inYourLibrary: First recipe');
  fireEvent.click(first);
  expect(apiFetch).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('status')).toHaveTextContent('library.inYourLibrary: First recipe');
});

test('a failed bookmark keeps the recipe browsable and lets the same control retry', async () => {
  query.value = 'view=public';
  mine.mockResolvedValue(page('Private recipe'));
  catalog.mockResolvedValue(page('Public recipe'));
  const { apiFetch } = await import('../lib/api');
  vi.mocked(apiFetch).mockReset().mockResolvedValueOnce(new Response('{}', { status: 500 })).mockResolvedValueOnce(new Response('{}'));
  render(<LibraryPage />);
  const bookmark = await screen.findByRole('button', { name: 'library.addToMyLibrary: Public recipe' });
  fireEvent.click(bookmark);
  expect(await screen.findByRole('alert')).toHaveTextContent('library.copyError');
  expect(bookmark).toHaveAttribute('aria-disabled', 'false');
  expect(screen.getByRole('heading', { name: 'Public recipe' }).closest('a')).toHaveAttribute('href', '/library/public/Public%20recipe');
  fireEvent.click(bookmark);
  await waitFor(() => expect(bookmark).toHaveAttribute('aria-label', 'library.inYourLibrary: Public recipe'));
  expect(apiFetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
