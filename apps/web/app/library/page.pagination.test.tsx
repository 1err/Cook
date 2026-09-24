import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { RecipePage } from '@cooking/shared';
import LibraryPage from './page';
const { mine, catalog, query } = vi.hoisted(() => ({mine:vi.fn(),catalog:vi.fn(),query:{value:""}}));
vi.mock('next/navigation', () => ({useSearchParams: () => new URLSearchParams(query.value)}));
vi.mock('../components/RequireAuth', () => ({RequireAuth: ({children}: {children:ReactNode}) => <>{children}</>}));
vi.mock('../lib/i18n', () => ({useT: () => (key:string) => key, useI18n: () => ({language:'en'})}));
vi.mock('../lib/api', () => ({apiFetch:vi.fn(),webApiClient:{recipes:{page:mine,catalogPage:catalog}}}));
const page = (id:string, next_cursor:string|null=null, already_saved=false):RecipePage => ({items:[{id,title:id,ingredient_count:0,step_count:0,already_saved}],next_cursor});
beforeEach(() => {query.value="";mine.mockReset();catalog.mockReset();vi.stubGlobal('ResizeObserver',class {observe(){}disconnect(){}});});
afterEach(() => {cleanup();vi.unstubAllGlobals();});

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
  expect(await screen.findByRole('button',{name:'library.inYourLibrary'})).toBeDisabled();
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
  expect(await screen.findByRole('alert')).toHaveTextContent('Catalog offline');
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
  fireEvent.click(await screen.findByRole('button', { name: 'library.addToMyLibrary' }));
  await screen.findByRole('button', { name: 'library.inYourLibrary' });
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
  fireEvent.click(await screen.findByRole('button', { name: 'library.addToMyLibrary' }));
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
