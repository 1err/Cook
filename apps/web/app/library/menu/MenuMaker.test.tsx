import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_MAP, type Recipe } from '@cooking/shared';
import { MenuMaker } from './MenuMaker';
const mocks = vi.hoisted(() => ({ creationAccess: vi.fn(), create: vi.fn(), access: vi.fn(), generate: vi.fn(), status: vi.fn(), file: vi.fn(), user: { id: 'account-a' } }));
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../lib/i18n', () => { const t = (key: string, vars?: Record<string, string | number>) => (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? '')); return { useT: () => t, useI18n: () => ({ language: 'en', t }) }; });
vi.mock('../../lib/api', () => ({ webApiClient: { menus: { access: mocks.creationAccess, create: mocks.create, artworkAccess: mocks.access, generateArtwork: mocks.generate, artworkStatus: mocks.status, artworkFile: mocks.file } } }));
vi.mock('./menuAssets', () => ({ artworkResponseDataUrl: async () => 'data:image/png;base64,iVBORw0KGgo=' }));
const recipes = [{ id:'one', title:'Apple tart', description:'Warm apple', thumbnail_url:'/apple.png' }, { id:'two', title:'Basil noodles', description:'Fresh basil' }, { id:'three', title:'Coconut cake', description:'' }] as Recipe[];
beforeEach(() => {
 mocks.user = { id:'account-a' };
 mocks.creationAccess.mockReset().mockResolvedValue({ allowed:true, is_admin:false, daily_limit:1, remaining:1, resets_at:'2026-09-28T00:00:00Z' });
 mocks.access.mockReset().mockResolvedValue({ enabled:true, allowed:true, daily_limit:3, remaining:3 });
 mocks.create.mockReset(); mocks.generate.mockReset(); mocks.status.mockReset(); mocks.file.mockReset().mockResolvedValue(new Response());
});
afterEach(cleanup);
describe('simple menu form', () => {
 it('shows a compact list and prompt together without a style/editor step', async () => {
  render(<MenuMaker recipes={recipes} initialSelectedIds={['one']} onClose={vi.fn()} />);
  expect(screen.getAllByRole('checkbox')).toHaveLength(3);
  expect(screen.queryByRole('link', { name:/Apple tart/ })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Menu title (optional)')).toBeVisible();
  expect(screen.getByLabelText('Describe your menu (optional)')).toBeVisible();
  expect(screen.queryByRole('button', { name:'Choose a style' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(document.querySelector('img[src="/apple.png"]')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name:'Generate menu' })).toBeEnabled());
  expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.generate).not.toHaveBeenCalled();
 });
 it('selects the complete library under a filter, keeps hidden selections, and clears', async () => {
  const user = userEvent.setup(); render(<MenuMaker recipes={recipes} initialSelectedIds={['two']} onClose={vi.fn()} />);
  await user.type(screen.getByRole('searchbox'), 'Apple');
  expect(screen.getAllByRole('checkbox')).toHaveLength(1);
  await user.click(screen.getByRole('checkbox'));
  expect(screen.getByText('2 dishes selected')).toBeVisible();
  await user.click(screen.getByRole('button', { name:'Select all recipes' }));
  expect(screen.getByText('3 dishes selected')).toBeVisible();
  await user.click(screen.getByRole('button', { name:'Clear selection' }));
  expect(screen.getByRole('button', { name:'Generate menu' })).toBeDisabled();
 });
 it('submits one full-image request with exact names, optional title and description and shows the downloadable result', async () => {
  mocks.generate.mockResolvedValue({ status:'completed' });
  const user = userEvent.setup(); render(<MenuMaker recipes={recipes} initialSelectedIds={['two','one']} onClose={vi.fn()} />);
  await user.type(screen.getByLabelText('Menu title (optional)'), 'Our little kitchen');
  await user.type(screen.getByLabelText('Describe your menu (optional)'), 'Cute tomatoes and watercolor dishes');
  await waitFor(() => expect(screen.getByRole('button', { name:'Generate menu' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name:'Generate menu' }));
  expect(await screen.findByRole('img', { name:'AI-generated menu with your selected dishes' })).toHaveAttribute('src','data:image/png;base64,iVBORw0KGgo=');
  expect(screen.getByRole('link', { name:'Download menu' })).toHaveAttribute('download','Our-little-kitchen.png');
  expect(mocks.generate.mock.calls[0][0]).toEqual({ request_id:expect.any(String), mode:'full-menu-v1', title:'Our little kitchen', brief:'Cute tomatoes and watercolor dishes', recipes:[{ recipe_id:'two', name:'Basil noodles' }, { recipe_id:'one', name:'Apple tart' }] });
  expect(mocks.generate).toHaveBeenCalledTimes(1); expect(mocks.create).not.toHaveBeenCalled();
  expect(screen.queryByRole('button', { name:'Use artwork' })).not.toBeInTheDocument();
 });
 it('selects all 25 recipes without truncation and explains the image limit before any paid request', async () => {
  const large = Array.from({ length:25 }, (_,i) => ({ id:`r${i}`, title:`Dish ${i}` })) as Recipe[];
  const user = userEvent.setup(); render(<MenuMaker recipes={large} initialSelectedIds={[]} onClose={vi.fn()} />);
  await user.click(screen.getByRole('button', { name:'Select all recipes' }));
  expect(screen.getByText('25 dishes selected')).toBeVisible();
  expect(screen.getByText('Choose up to 24 dishes so everything fits clearly on one menu.')).toBeVisible();
  expect(screen.getByRole('button', { name:'Generate menu' })).toBeDisabled();
  expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
 });
 it('supports an empty library without generating', () => {
  render(<MenuMaker recipes={[]} initialSelectedIds={[]} onClose={vi.fn()} />);
  expect(screen.getByText('Import a recipe to make your first menu.')).toBeVisible();
  expect(screen.getByRole('link', { name:'Import recipe' })).toHaveAttribute('href','/import');
  expect(screen.getByRole('button', { name:'Generate menu' })).toBeDisabled();
 });
 it('does not create or generate when the daily menu allowance is exhausted', async () => {
  mocks.creationAccess.mockResolvedValue({ allowed:false, is_admin:false, daily_limit:1, remaining:0, resets_at:'2026-09-28T00:00:00Z' });
  render(<MenuMaker recipes={recipes} initialSelectedIds={['one']} onClose={vi.fn()} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('You’ve created today’s menu.');
  expect(screen.getByRole('button', { name:'Generate menu' })).toBeDisabled();
  expect(mocks.generate).not.toHaveBeenCalled(); expect(mocks.create).not.toHaveBeenCalled();
 });
 it('keeps the selection after an authoritative quota rejection racing the access check', async () => {
  mocks.generate.mockRejectedValueOnce({ status:429, code:'menu_daily_limit' });
  const user = userEvent.setup(); render(<MenuMaker recipes={recipes} initialSelectedIds={['one']} onClose={vi.fn()} />);
  await waitFor(() => expect(screen.getByRole('button', { name:'Generate menu' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name:'Generate menu' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('You’ve created today’s menu.');
  expect(screen.getByText('1 dishes selected')).toBeVisible();
  expect(screen.getByRole('button', { name:'Generate menu' })).toBeDisabled();
 });
 it('refreshes changed library recipes without losing the title, description or still-available selection', async () => {
  mocks.generate.mockRejectedValueOnce({ status:409,code:'recipe_changed' });
  const fresh=recipes.map(recipe => recipe.id === 'one' ? { ...recipe,title:'Fresh apple tart' } : recipe).filter(recipe => recipe.id !== 'two');
  const refreshed=vi.fn().mockResolvedValue(fresh);
  function Harness() { const [rows,setRows]=React.useState(recipes); return <MenuMaker recipes={rows} initialSelectedIds={['one','two']} onClose={vi.fn()} onRefreshRecipes={async () => { const next=await refreshed(); setRows(next); return next; }} />; }
  const user=userEvent.setup(); render(<Harness />);
  await user.type(screen.getByLabelText('Menu title (optional)'),'Keep my title');
  await user.type(screen.getByLabelText('Describe your menu (optional)'),'Keep my watercolor notes');
  await user.click(screen.getByRole('button',{ name:'Generate menu' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Your library changed.');
  await user.click(screen.getByRole('button',{ name:'Refresh' }));
  await waitFor(() => expect(screen.getByRole('checkbox',{ name:'Select Fresh apple tart' })).toBeChecked());
  expect(screen.getByText('1 dishes selected')).toBeVisible();
  expect(screen.getByLabelText('Menu title (optional)')).toHaveValue('Keep my title');
  expect(screen.getByLabelText('Describe your menu (optional)')).toHaveValue('Keep my watercolor notes');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(mocks.generate).toHaveBeenCalledTimes(1); expect(refreshed).toHaveBeenCalledTimes(1);
 });
 it('shows unlimited menu creation for admins', async () => {
  mocks.creationAccess.mockResolvedValue({ allowed:true, is_admin:true, daily_limit:null, remaining:null, resets_at:'2026-09-28T00:00:00Z' });
  render(<MenuMaker recipes={recipes} initialSelectedIds={['one']} onClose={vi.fn()} />);
  expect(await screen.findByText('Unlimited menu creation for admins.')).toBeVisible();
  expect(screen.getByRole('button', { name:'Generate menu' })).toBeEnabled();
 });
});
