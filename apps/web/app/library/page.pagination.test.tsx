import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { RecipePage } from '@cooking/shared';
import LibraryPage from './page';
const { mine, catalog, blockAuthor, query } = vi.hoisted(() => ({mine:vi.fn(),catalog:vi.fn(),blockAuthor:vi.fn(),query:{value:""}}));
vi.mock('../lib/auth', () => ({ useAuth: () => ({ user: { id: 'account-a' } }) }));
vi.mock('next/navigation', () => ({useSearchParams: () => new URLSearchParams(query.value)}));
vi.mock('../components/RequireAuth', () => ({RequireAuth: ({children}: {children:ReactNode}) => <>{children}</>}));
vi.mock('../lib/i18n', async () => {
  const { MESSAGE_MAP } = await import('@cooking/shared');
  return {useT: () => (key:string, vars?: Record<string, string | number>) => key.startsWith('recipe.timing.') || key === 'recipe.totalTime.minutesSuffix'
    ? (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? ''))
    : key, useI18n: () => ({language:'en'})};
});
vi.mock('../lib/api', () => ({apiFetch:vi.fn(),webApiClient:{recipes:{page:mine,catalogPage:catalog},users:{blockRecipeAuthor:blockAuthor}}}));
const page = (id:string, next_cursor:string|null=null, already_saved=false):RecipePage => ({items:[{id,title:id,ingredient_count:0,step_count:0,already_saved}],next_cursor});
beforeEach(() => {query.value="";mine.mockReset();catalog.mockReset();blockAuthor.mockReset().mockResolvedValue({ok:true});vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});});
afterEach(() => {cleanup();vi.unstubAllGlobals();});

test('public cards use timing summaries and retain the independent copy action', async () => {
  query.value = 'view=public';
  mine.mockResolvedValue(page('Private recipe'));
  catalog.mockResolvedValue({ items: [{ ...page('Slow public recipe').items[0], total_time_minutes: 500,
    timing_summary: { hands_on_minutes: 20, passive_minutes: 480, is_estimate: false } }], next_cursor: null });
  const { apiFetch } = await import('../lib/api');
  vi.mocked(apiFetch).mockImplementation(async () => new Response('{}'));
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
  expect(await screen.findByRole('button', { name: /^library.removeFromLibrary:/ })).toHaveAttribute('aria-pressed', 'true');
  expect(apiFetch).toHaveBeenLastCalledWith('/recipes/catalog/Slow%20public%20recipe/copy', { method: 'POST', headers: { 'X-Chef-World-Account-ID': 'account-a' } });
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
  expect(mine).toHaveBeenLastCalledWith({q:'',tags:[],cursor:'next',expectedAccountId:'account-a'});
  fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Needle'}});
  expect(await screen.findByRole('heading',{name:'Needle'})).toBeVisible();
  expect(screen.queryByRole('heading',{name:'First'})).not.toBeInTheDocument();
  expect(mine).toHaveBeenLastCalledWith({q:'Needle',tags:[],cursor:null,expectedAccountId:'account-a'});
  fireEvent.click(screen.getByRole('tab',{name:'library.publicLibrary'}));
  expect(await screen.findByRole('button',{name:/^library.removeFromLibrary:/})).toHaveAttribute('aria-pressed', 'true');
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
  vi.mocked(apiFetch).mockImplementation(async () => new Response('{}'));
  mine.mockResolvedValueOnce(page('Previously saved')).mockResolvedValueOnce(page('Newly copied'));
  catalog.mockResolvedValueOnce(page('Public recipe'));
  render(<LibraryPage />);
  await screen.findByRole('heading', { name: 'Previously saved' });
  fireEvent.click(screen.getByRole('tab', { name: 'library.publicLibrary' }));
  fireEvent.click(await screen.findByRole('button', { name: /^library.addToMyLibrary:/ }));
  await screen.findByRole('button', { name: /^library.removeFromLibrary:/ });
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
  const copyButton = screen.getByRole('button', { name: /^library.removeFromLibrary:/ });
  expect(copyButton).toHaveAttribute('aria-pressed', 'true');
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
  await act(async () => { pending.get('/recipes/catalog/Second%20recipe/copy')!(new Response('{}')); });
  expect(first).toHaveAttribute('aria-busy', 'true');
  expect(second).toHaveAttribute('aria-busy', 'false');
  expect(second).toHaveAttribute('aria-label', 'library.removeFromLibrary: Second recipe');
  await act(async () => { pending.get('/recipes/catalog/First%20recipe/copy')!(new Response('{}')); });
  expect(first).toHaveFocus();
  expect(first).toHaveAttribute('aria-label', 'library.removeFromLibrary: First recipe');
  expect(first).toHaveAttribute('aria-pressed', 'true');
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
  await waitFor(() => expect(bookmark).toHaveAttribute('aria-label', 'library.removeFromLibrary: Public recipe'));
  expect(apiFetch).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});


test('a saved bookmark removes and restores the same card despite a stale catalog response', async () => {
  query.value = 'view=public';
  mine.mockResolvedValue(page('Private recipe'));
  catalog.mockResolvedValue(page('Saved recipe', null, true));
  const { apiFetch } = await import('../lib/api');
  let finish!: (response: Response) => void;
  vi.mocked(apiFetch).mockReset().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; })).mockImplementation(async () => new Response('{}'));
  render(<LibraryPage />);
  const bookmark = await screen.findByRole('button', { name: 'library.removeFromLibrary: Saved recipe' });
  bookmark.focus();
  fireEvent.click(bookmark);
  fireEvent.click(bookmark);
  expect(apiFetch).toHaveBeenCalledTimes(1);
  expect(apiFetch).toHaveBeenLastCalledWith('/recipes/catalog/Saved%20recipe/saved', { method: 'DELETE', headers: { 'X-Chef-World-Account-ID': 'account-a' } });
  expect(bookmark).toHaveAttribute('aria-busy', 'true');
  expect(bookmark).toHaveAttribute('aria-label', 'library.removing: Saved recipe');
  await act(async () => { finish(new Response(null, { status: 204 })); });
  await waitFor(() => expect(bookmark).toHaveAttribute('aria-pressed', 'false'));
  expect(bookmark).toHaveFocus();
  expect(bookmark).toHaveAttribute('aria-label', 'library.addToMyLibrary: Saved recipe');
  expect(screen.getByRole('status')).toHaveTextContent('library.removedFromLibrary: Saved recipe');
  expect(catalog).toHaveBeenCalledTimes(1);
  fireEvent.click(bookmark);
  await waitFor(() => expect(bookmark).toHaveAttribute('aria-pressed', 'true'));
  expect(apiFetch).toHaveBeenLastCalledWith('/recipes/catalog/Saved%20recipe/copy', { method: 'POST', headers: { 'X-Chef-World-Account-ID': 'account-a' } });
  expect(screen.getByRole('heading', { name: 'Saved recipe' })).toBeVisible();
});

test('a failed removal keeps the filled bookmark and allows retry', async () => {
  query.value = 'view=public';
  mine.mockResolvedValue(page('Private recipe'));
  catalog.mockResolvedValue(page('Saved recipe', null, true));
  const { apiFetch } = await import('../lib/api');
  vi.mocked(apiFetch).mockReset().mockResolvedValueOnce(new Response('{}', { status: 500 })).mockResolvedValueOnce(new Response(null, { status: 204 }));
  render(<LibraryPage />);
  const bookmark = await screen.findByRole('button', { name: 'library.removeFromLibrary: Saved recipe' });
  fireEvent.click(bookmark);
  expect(await screen.findByRole('alert')).toHaveTextContent('library.removeError');
  expect(bookmark).toHaveAttribute('aria-pressed', 'true');
  expect(bookmark).toHaveAttribute('aria-disabled', 'false');
  fireEvent.click(bookmark);
  await waitFor(() => expect(bookmark).toHaveAttribute('aria-pressed', 'false'));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});


test('toggling a recipe on a later catalog page preserves loaded cards and keyboard focus', async () => {
  query.value = 'view=public';
  mine.mockResolvedValue(page('Private recipe'));
  catalog.mockResolvedValueOnce(page('First recipe', 'page-two'))
    .mockResolvedValueOnce(page('Later recipe', null, true))
    .mockResolvedValue(page('First recipe', 'page-two'));
  const { apiFetch } = await import('../lib/api');
  vi.mocked(apiFetch).mockReset().mockImplementation(async () => new Response('{}'));
  render(<LibraryPage />);
  await screen.findByRole('heading', { name: 'First recipe' });
  fireEvent.click(screen.getByRole('button', { name: 'common.loadMoreRecipes' }));
  const bookmark = await screen.findByRole('button', { name: 'library.removeFromLibrary: Later recipe' });
  bookmark.focus();
  fireEvent.click(bookmark);
  await waitFor(() => expect(bookmark).toHaveAttribute('aria-pressed', 'false'));
  expect(screen.getByRole('heading', { name: 'Later recipe' })).toBeVisible();
  expect(bookmark).toHaveFocus();
  fireEvent.click(bookmark);
  await waitFor(() => expect(bookmark).toHaveAttribute('aria-pressed', 'true'));
  expect(screen.getByRole('heading', { name: 'First recipe' })).toBeVisible();
  expect(screen.getByRole('heading', { name: 'Later recipe' })).toBeVisible();
  expect(bookmark).toHaveFocus();
  expect(catalog).toHaveBeenCalledTimes(2);
});


test('linked public cards reconcile together and wait for the related pending mutation', async () => {
  query.value = 'view=public';
  mine.mockResolvedValue(page('Private recipe'));
  catalog.mockResolvedValue({ items: [page('Source', null, true).items[0],
    {...page('Published copy', null, true).items[0], catalog_source_recipe_id: 'Source'}], next_cursor: null });
  const { apiFetch } = await import('../lib/api');
  let finish!: (response: Response) => void;
  vi.mocked(apiFetch).mockReset().mockImplementationOnce(() => new Promise<Response>(resolve => { finish = resolve; }))
    .mockImplementation(async () => new Response(JSON.stringify({bookmark_states: {Source: true, 'Published copy': true}})));
  render(<LibraryPage />);
  const source = await screen.findByRole('button', { name: 'library.removeFromLibrary: Source' });
  const copy = screen.getByRole('button', { name: 'library.removeFromLibrary: Published copy' });
  fireEvent.click(source);
  fireEvent.click(copy);
  expect(apiFetch).toHaveBeenCalledTimes(1);
  expect(copy).toHaveAttribute('aria-busy','true');
  await act(async () => {finish(new Response(JSON.stringify({bookmark_states: {Source: false, 'Published copy': false}})));});
  await waitFor(() => expect(source).toHaveAttribute('aria-pressed','false'));
  expect(copy).toHaveAttribute('aria-pressed','false');
  fireEvent.click(copy);
  await waitFor(() => expect(source).toHaveAttribute('aria-pressed','true'));
  expect(copy).toHaveAttribute('aria-pressed','true');
  expect(apiFetch).toHaveBeenCalledTimes(2);
  expect(catalog).toHaveBeenCalledTimes(1);
});


test('blocking hides obsolete catalog rows and retains a retry after refresh failure', async () => {
 query.value='view=public';
 mine.mockResolvedValue(page('Private recipe'));
 catalog.mockResolvedValueOnce({...page('Shared recipe'),items:[{...page('Shared recipe').items[0],shared_media_status:'pending'}]})
   .mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page('Safe recipe'));
 vi.spyOn(window,'confirm').mockReturnValue(true);
 render(<LibraryPage />);
 await screen.findByRole('heading',{name:'Shared recipe'});
 expect(screen.getByText('safety.photosPending')).toBeVisible();
 expect(screen.getByRole('button',{name:'safety.report: Shared recipe'})).toBeEnabled();
 fireEvent.click(screen.getByRole('button',{name:'safety.blockAuthor'}));
 await waitFor(()=>expect(blockAuthor).toHaveBeenCalledWith('Shared recipe','account-a'));
 expect(await screen.findByRole('alert')).toHaveTextContent('library.loadErrorTitle');
 expect(screen.queryByRole('heading',{name:'Shared recipe'})).not.toBeInTheDocument();
 fireEvent.click(screen.getByRole('button',{name:'library.retry'}));
 expect(await screen.findByRole('heading',{name:'Safe recipe'})).toBeVisible();
});


test('a fresh filter load recovers after a failed post-block refresh', async () => {
 query.value='view=public';mine.mockResolvedValue(page('Private recipe'));
 catalog.mockResolvedValueOnce(page('Shared recipe')).mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page('Filtered recipe'));
 vi.spyOn(window,'confirm').mockReturnValue(true);render(<LibraryPage />);
 await screen.findByRole('heading',{name:'Shared recipe'});
 fireEvent.click(screen.getByRole('button',{name:'safety.blockAuthor'}));
 await screen.findByRole('alert');
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Filtered'}});
 expect(await screen.findByRole('heading',{name:'Filtered recipe'})).toBeVisible();
});

test('a completed block reloads the current filter even when its old row was unmounted', async () => {
 query.value='view=public';mine.mockResolvedValue(page('Private recipe'));
 catalog.mockResolvedValueOnce(page('First shared recipe')).mockResolvedValueOnce(page('Current shared recipe')).mockResolvedValueOnce(page('Safe current recipe'));
 let finish!:(value:{ok:boolean})=>void;blockAuthor.mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
 vi.spyOn(window,'confirm').mockReturnValue(true);render(<LibraryPage />);
 await screen.findByRole('heading',{name:'First shared recipe'});
 fireEvent.click(screen.getByRole('button',{name:'safety.blockAuthor'}));
 fireEvent.change(screen.getByRole('searchbox'),{target:{value:'Current'}});
 await screen.findByRole('heading',{name:'Current shared recipe'});
 await act(async()=>{finish({ok:true});});
 expect(await screen.findByRole('heading',{name:'Safe current recipe'})).toBeVisible();
 expect(catalog).toHaveBeenLastCalledWith(expect.objectContaining({q:'Current'}));
});
