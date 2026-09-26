import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MESSAGE_MAP, type Recipe } from '@cooking/shared';
import { MenuMaker } from './MenuMaker';
const mocks = vi.hoisted(() => ({ creationAccess: vi.fn(), create: vi.fn(), access: vi.fn(), generate: vi.fn(), status: vi.fn(), file: vi.fn(), user: { id: 'account-a' } }));
vi.mock('../../lib/auth', () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock('../../lib/i18n', () => ({ useT: () => (key: string, vars?: Record<string, string | number>) => (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => String(vars?.[k] ?? '')) }));
vi.mock('../../lib/api', () => ({ webApiClient: { menus: { access: mocks.creationAccess, create: mocks.create, artworkAccess: mocks.access, generateArtwork: mocks.generate, artworkStatus: mocks.status, artworkFile: mocks.file } } }));
vi.mock('./menuAssets', () => ({ loadMenuFonts: async () => [], artworkResponseDataUrl: async () => 'data:image/png;base64,iVBORw0KGgo=' }));
const recipes = [ {id:'one',title:'Apple tart',description:'Warm apple'}, {id:'two',title:'Basil noodles',description:'Fresh basil'}, {id:'three',title:'Coconut cake',description:''} ] as Recipe[];
beforeEach(() => { mocks.creationAccess.mockReset().mockResolvedValue({ allowed: true, is_admin: false, daily_limit: 1, remaining: 1, resets_at: '2026-09-27T00:00:00Z' }); mocks.create.mockReset().mockImplementation(async (payload) => ({ ...payload, created_at: '2026-09-26T00:00:00Z' })); vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); mocks.access.mockResolvedValue({ enabled: true, allowed: true, daily_limit: 3, remaining: 3 }); mocks.generate.mockReset(); mocks.status.mockReset(); });
afterEach(cleanup);
describe('menu session', () => {
 it('keeps the editor open across the StrictMode mount-cleanup-remount cycle', async () => {
  const back = vi.spyOn(window.history,'back'); const close = vi.fn();
  const view = render(<React.StrictMode><MenuMaker recipes={recipes} initialSelectedIds={[]} onClose={close} /></React.StrictMode>);
  await waitFor(() => expect(screen.getByRole('button',{name:'Select all recipes'})).toBeVisible());
  expect(back).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled();
  view.unmount(); back.mockRestore();
 });
 it('selects the complete library under a filter, clears selection, and retains edited names after Back', async () => {
  const user = userEvent.setup(); render(<MenuMaker recipes={recipes} initialSelectedIds={[]} onClose={vi.fn()} />);
  await user.type(screen.getByRole('searchbox'), 'Apple');
  await user.click(screen.getByRole('button',{name:'Select matching recipes'}));
  expect(screen.getByText('1 dishes selected')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Select all recipes'}));
  expect(screen.getByText('3 dishes selected')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Clear selection'}));
  expect(screen.getByRole('button',{name:'Choose a style'})).toBeDisabled();
  await user.click(screen.getByRole('button',{name:'Select all recipes'}));
  await user.click(screen.getByRole('button',{name:'Choose a style'}));
  const first = screen.getAllByLabelText('Dish name')[0]; await user.clear(first); await user.type(first,'My special tart');
  await user.click(screen.getByRole('button',{name:'Back to dishes'}));
  await user.click(screen.getByRole('button',{name:'Choose a style'}));
  expect(screen.getByDisplayValue('My special tart')).toBeInTheDocument();
  expect(mocks.create).toHaveBeenCalledTimes(1); expect(recipes[0].title).toBe('Apple tart'); expect(mocks.generate).not.toHaveBeenCalled();
 });
 it('shows an empty selection without throwing', () => {
  render(<MenuMaker recipes={[]} initialSelectedIds={[]} onClose={vi.fn()} />);
  expect(screen.getByText('Import a recipe to make your first menu.')).toBeInTheDocument();
  expect(screen.getByRole('link',{name:'Import recipe'})).toHaveAttribute('href','/import');
  expect(screen.getByRole('button',{name:'Choose a style'})).toBeDisabled();
 });
 it('requires explicit artwork acceptance and preserves the draft through a style change', async () => {
  mocks.generate.mockResolvedValue({request_id:'unused',status:'completed',image_url:'/unused.png'}); mocks.file.mockResolvedValue(new Response());
  const user = userEvent.setup(); render(<MenuMaker recipes={recipes} initialSelectedIds={['one']} onClose={vi.fn()} />);
  await user.click(screen.getByRole('button',{name:'Choose a style'}));
  await user.click(screen.getByRole('button',{name:'Generate artwork'}));
  await waitFor(() => expect(screen.getByRole('button',{name:'Use artwork'})).toBeEnabled());
  expect(screen.queryByText(/Artwork in use/)).not.toBeInTheDocument();
  await user.click(screen.getByRole('radio',{name:'French bistro'}));
  expect(screen.getByText('Artwork created for Cozy cafe')).toBeInTheDocument();
  await user.click(screen.getByRole('button',{name:'Use artwork'}));
  expect(screen.getByText(/Artwork in use/)).toBeInTheDocument();
  expect(mocks.generate.mock.calls[0][0]).toMatchObject({style_id:'cozy-cafe',instructions:''});
  expect(Object.keys(mocks.generate.mock.calls[0][0]).sort()).toEqual(['instructions','request_id','style_id']);
 });
});


it('does not admit a new menu when the non-admin daily allowance is exhausted', async () => {
 mocks.creationAccess.mockResolvedValue({allowed:false,is_admin:false,daily_limit:1,remaining:0,resets_at:'2026-09-27T00:00:00Z'});
 const user = userEvent.setup(); render(<MenuMaker recipes={recipes} initialSelectedIds={[]} onClose={vi.fn()} />);
 await user.click(screen.getByRole('button',{name:'Select all recipes'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('You’ve created today’s menu.');
 expect(screen.getByRole('button',{name:'Choose a style'})).toBeDisabled();
 expect(mocks.create).not.toHaveBeenCalled();
});
it('allows admin menu creation and describes the unlimited allowance', async () => {
 mocks.creationAccess.mockResolvedValue({allowed:true,is_admin:true,daily_limit:null,remaining:null,resets_at:'2026-09-27T00:00:00Z'});
 const user = userEvent.setup(); render(<MenuMaker recipes={recipes} initialSelectedIds={['one']} onClose={vi.fn()} />);
 expect(await screen.findByText('Unlimited menu creation for admins.')).toBeVisible();
 await user.click(screen.getByRole('button',{name:'Choose a style'}));
 expect(await screen.findByLabelText('Menu title')).toBeVisible();
 expect(mocks.create).toHaveBeenCalledTimes(1);
});
it('preserves selected recipes and retries the same admission ID after an ambiguous response', async () => {
 mocks.create.mockRejectedValueOnce(new TypeError('Network failed'));
 const user = userEvent.setup(); render(<MenuMaker recipes={recipes} initialSelectedIds={['one']} onClose={vi.fn()} />);
 await waitFor(() => expect(screen.getByRole('button',{name:'Choose a style'})).toBeEnabled());
 await user.click(screen.getByRole('button',{name:'Choose a style'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('Your recipe selection is kept');
 expect(screen.getByText('1 dishes selected')).toBeVisible();
 await user.click(screen.getByRole('button',{name:'Choose a style'}));
 expect(await screen.findByLabelText('Menu title')).toBeVisible();
 expect(mocks.create.mock.calls[0][0]).toEqual(mocks.create.mock.calls[1][0]);
});
it('keeps the selection after an authoritative quota rejection racing the access check', async () => {
 mocks.create.mockRejectedValueOnce({code:'menu_daily_limit'});
 const user = userEvent.setup(); render(<MenuMaker recipes={recipes} initialSelectedIds={['one']} onClose={vi.fn()} />);
 await waitFor(() => expect(screen.getByRole('button',{name:'Choose a style'})).toBeEnabled());
 await user.click(screen.getByRole('button',{name:'Choose a style'}));
 expect(await screen.findByRole('alert')).toHaveTextContent('You’ve created today’s menu.');
 expect(screen.getByText('1 dishes selected')).toBeVisible();
 expect(screen.getByRole('button',{name:'Choose a style'})).toBeDisabled();
});
