import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MenuMakerScreen } from './MenuMakerScreen';

let mockAccount = 'a';
let mockPreviewProps: any;
let mockGuard: { enabled: boolean; callback: (event: any) => void };
const mockList = jest.fn();
const mockAccess = jest.fn();
const mockGenerate = jest.fn();
const mockCreationAccess = jest.fn();
const mockCreate = jest.fn();
const mockApi = { recipes: { list: mockList }, menus: { access: mockCreationAccess, create: mockCreate, artworkAccess: mockAccess, generateArtwork: mockGenerate, artworkStatus: jest.fn(), artworkFile: jest.fn() } };
const mockTranslate = (key: string, variables?: Record<string, string | number>) => {
  const { MESSAGE_MAP } = require('@cooking/shared');
  return (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_: string, token: string) => String(variables?.[token] ?? ''));
};
jest.mock('../../lib/i18n', () => ({ useT: () => mockTranslate }));
jest.mock('../../lib/api', () => ({ useApiClient: () => mockApi }));
jest.mock('../../lib/auth', () => ({ useAuth: () => ({ user: { id: mockAccount } }) }));
jest.mock('@react-navigation/native', () => ({ UNSTABLE_usePreventRemove: (enabled: boolean, callback: any) => { mockGuard = { enabled, callback }; } }));
jest.mock('./menuAssets', () => ({ loadMenuFonts: jest.fn(async () => []), artworkResponseDataUrl: jest.fn(async () => 'data:image/png;base64,iVBORw0KGgo=') }));
jest.mock('./MenuPreview', () => ({ MenuPreview: (props: any) => { mockPreviewProps = props; return null; } }));
jest.mock('./menuExport', () => ({ shareMenuPdf: jest.fn(), printMenu: jest.fn(), SharingUnavailableError: class extends Error {} }));
const recipes = [{ id: 'one', title: 'Noodles', description: 'Sesame' }, { id: 'two', title: 'Soup', description: 'Ginger' }];
const navigation = { dispatch: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() };
const props = (ids = ['one']) => ({ navigation: navigation as never, route: { key: 'menu', name: 'MenuMaker' as const, params: { recipeIds: ids } } });
beforeEach(() => {
  jest.clearAllMocks(); mockAccount = 'a'; mockPreviewProps = undefined;
  mockList.mockResolvedValue(recipes);
  mockCreationAccess.mockResolvedValue({allowed:true,is_admin:false,daily_limit:1,remaining:1,resets_at:'2026-09-27T00:00:00Z'});
  mockCreate.mockReset().mockImplementation(async payload => ({...payload,created_at:'2026-09-26T00:00:00Z'}));
  mockAccess.mockResolvedValue({ enabled: true, allowed: true, remaining: 2, daily_limit: 3, reason: null });
});
test('edits a session copy and retains text when returning to all-owned selection', async () => {
  await render(<MenuMakerScreen {...props()} />);
  await waitFor(() => expect(screen.getByDisplayValue('Noodles')).toBeOnTheScreen());
  await fireEvent.changeText(screen.getByLabelText('Dish name'), 'My noodles');
  await fireEvent.press(screen.getByRole('button', { name: 'Back to dishes' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Select all recipes' }));
  expect(screen.getByText('2 dishes selected')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', { name: 'Choose a style' }));
  expect(screen.getByDisplayValue('My noodles')).toBeOnTheScreen();
  expect(screen.getByDisplayValue('Soup')).toBeOnTheScreen();
  expect(mockCreate).toHaveBeenCalledTimes(1); expect(recipes[0].title).toBe('Noodles'); expect(mockList).toHaveBeenCalledTimes(1);
});
test('errors on a missing selected ID without silently making a partial menu', async () => {
  await render(<MenuMakerScreen {...props(['one', 'missing'])} />);
  await waitFor(() => expect(screen.getByText(/Some selected recipes/)).toBeOnTheScreen());
  expect(screen.queryByLabelText('Menu title')).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Select all recipes' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Choose a style' }));
  expect(screen.getByDisplayValue('Noodles')).toBeOnTheScreen();
});
test('empty library has a localized explanation and cannot continue', async () => {
  mockList.mockResolvedValue([]);
  await render(<MenuMakerScreen {...props([])} />);
  await waitFor(() => expect(screen.getByText('Import a recipe to make your first menu.')).toBeOnTheScreen());
  expect(screen.getByRole('button', { name: 'Choose a style' })).toBeDisabled();
});
test('individual selection includes only checked dishes', async () => {
  await render(<MenuMakerScreen {...props([])} />);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select Soup' })).toBeOnTheScreen());
  await fireEvent.press(screen.getByRole('checkbox', { name: 'Select Soup' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Choose a style' }));
  expect(screen.getByDisplayValue('Soup')).toBeOnTheScreen();
  expect(screen.queryByDisplayValue('Noodles')).toBeNull();
});
test('account changes destroy private drafts and do not reuse the old route selection', async () => {
  const view = await render(<MenuMakerScreen {...props()} />);
  await waitFor(() => expect(screen.getByDisplayValue('Noodles')).toBeOnTheScreen());
  await fireEvent.changeText(screen.getByLabelText('Menu title'), 'Private dinner');
  mockAccount = 'b'; mockList.mockResolvedValue([{ id: 'three', title: 'Rice' }]);
  await view.rerender(<MenuMakerScreen {...props()} />);
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Select Rice' })).toBeOnTheScreen());
  expect(screen.queryByDisplayValue('Private dinner')).toBeNull();
  expect(screen.getByText('0 dishes selected')).toBeOnTheScreen();
});
test('cancelled native navigation preserves edits; leave dispatches the original action', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<MenuMakerScreen {...props()} />);
  await waitFor(() => expect(screen.getByDisplayValue('Noodles')).toBeOnTheScreen());
  await fireEvent.changeText(screen.getByLabelText('Menu title'), 'Dinner');
  expect(mockGuard.enabled).toBe(true);
  const action = { type: 'GO_BACK' };
  await act(async () => mockGuard.callback({ data: { action } }));
  const buttons = alert.mock.calls[0][2]!;
  expect(buttons[0].text).toBe('Keep editing');
  expect(navigation.dispatch).not.toHaveBeenCalled();
  expect(screen.getByDisplayValue('Dinner')).toBeOnTheScreen();
  await act(async () => buttons[1].onPress?.());
  expect(navigation.dispatch).toHaveBeenCalledWith(action);
  alert.mockRestore();
});
test('quota failure preserves template editing and shows a localized error', async () => {
  mockGenerate.mockRejectedValue({ status: 429, code: 'daily_limit' });
  await render(<MenuMakerScreen {...props()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate artwork' })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: 'Generate artwork' }));
  await waitFor(() => expect(screen.getByText(/used today’s image allowance/)).toBeOnTheScreen());
  expect(screen.getByDisplayValue('Noodles')).toBeOnTheScreen();
  expect(mockGenerate.mock.calls[0][0]).toEqual({ request_id: expect.any(String), style_id: 'cozy-cafe', instructions: '' });
});


test('a late artwork candidate cannot change a new style without explicit acceptance', async () => {
  let complete!: (value: unknown) => void;
  mockGenerate.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  await render(<MenuMakerScreen {...props()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate artwork' })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: 'Generate artwork' }));
  await fireEvent.press(screen.getByRole('radio', { name: 'Garden table' }));
  const requestId = mockGenerate.mock.calls[0][0].request_id;
  await act(async () => complete({ request_id: requestId, status: 'completed' }));
  expect(screen.getByText('Artwork created for Cozy cafe')).toBeOnTheScreen();
  expect(screen.getByRole('radio', { name: 'Garden table' })).toBeChecked();
  expect(mockPreviewProps.assets.artworkDataUrl).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Use artwork' }));
  expect(screen.getByRole('radio', { name: 'Cozy cafe' })).toBeChecked();
  expect(mockPreviewProps.assets.artworkDataUrl).toMatch(/^data:image\/png;base64,/);
});

test('edits invalidate measured export immediately and stale ready cannot unlock it', async () => {
  const { layoutMenu } = require('@cooking/shared');
  await render(<MenuMakerScreen {...props()} />);
  await waitFor(() => expect(mockPreviewProps?.draft).toBeTruthy());
  const previous = mockPreviewProps;
  const layout = layoutMenu(previous.draft, (text: string) => text.length * 8);
  await act(async () => previous.onReady(layout, previous.revision));
  expect(screen.getByRole('button', { name: 'Share PDF' })).toBeEnabled();
  await fireEvent.changeText(screen.getByLabelText('Menu title'), 'Revised dinner');
  expect(screen.getByRole('button', { name: 'Share PDF' })).toBeDisabled();
  await act(async () => previous.onReady(layout, previous.revision));
  expect(screen.getByRole('button', { name: 'Share PDF' })).toBeDisabled();
  const current = mockPreviewProps;
  await act(async () => current.onReady(layoutMenu(current.draft, (text: string) => text.length * 8), current.revision));
  expect(screen.getByRole('button', { name: 'Share PDF' })).toBeEnabled();
});

test('global provider capacity leaves account allowance intact and gives temporary retry guidance', async () => {
  mockGenerate.mockRejectedValue({ status: 429, code: 'global_limit' });
  await render(<MenuMakerScreen {...props()} />);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generate artwork' })).toBeEnabled());
  await fireEvent.press(screen.getByRole('button', { name: 'Generate artwork' }));
  await waitFor(() => expect(screen.getByText('AI artwork is busy. Try again later; your menu is unchanged.')).toBeOnTheScreen());
  expect(screen.queryByText(/used today’s image allowance/)).toBeNull();
  expect(screen.getByText('2 of 3 image attempts left today.')).toBeOnTheScreen();
  expect(screen.getByDisplayValue('Noodles')).toBeOnTheScreen();
});

test('global-limit access status does not tell the account that its daily allowance is exhausted', async () => {
  mockAccess.mockResolvedValue({ enabled: true, allowed: false, remaining: 2, daily_limit: 3, reason: 'global_limit' });
  await render(<MenuMakerScreen {...props()} />);
  await waitFor(() => expect(screen.getByText('AI artwork is busy. Try again later; your menu is unchanged.')).toBeOnTheScreen());
  expect(screen.getByRole('button', { name: 'Generate artwork' })).toBeDisabled();
  expect(screen.queryByText(/used today’s image allowance/)).toBeNull();
});


test('initial recipe IDs cannot bypass daily menu admission', async () => {
  mockCreate.mockRejectedValueOnce({code:'menu_daily_limit'});
  await render(<MenuMakerScreen {...props()} />);
  expect(await screen.findByText(/You’ve created today’s menu/)).toBeOnTheScreen();
  expect(screen.queryByLabelText('Menu title')).toBeNull();
  expect(screen.getByRole('checkbox', {name:'Select Noodles'})).toBeChecked();
  expect(screen.getByRole('button', {name:'Choose a style'})).toBeDisabled();
});
test('an initially admitted menu requires confirmation before leaving even without edits', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<MenuMakerScreen {...props()} />);
  await screen.findByDisplayValue('Noodles');
  expect(mockCreate).toHaveBeenCalledTimes(1);
  expect(mockGuard.enabled).toBe(true);
  const action = { type: 'GO_BACK' };
  await act(async () => mockGuard.callback({ data: { action } }));
  expect(alert).toHaveBeenCalled();
  expect(alert.mock.calls[0][2]?.[0].text).toBe('Keep editing');
  expect(navigation.dispatch).not.toHaveBeenCalled();
  alert.mockRestore();
});
test('an ambiguous initial admission retry reuses the session request ID', async () => {
  mockCreate.mockRejectedValueOnce(new TypeError('Offline'));
  await render(<MenuMakerScreen {...props()} />);
  expect(await screen.findByText(/Your recipe selection is kept/)).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('button', {name:'Choose a style'}));
  expect(await screen.findByDisplayValue('Noodles')).toBeOnTheScreen();
  expect(mockCreate.mock.calls[0][0]).toEqual(mockCreate.mock.calls[1][0]);
});
test('admin selection shows the unlimited creation allowance', async () => {
  mockCreationAccess.mockResolvedValue({allowed:true,is_admin:true,daily_limit:null,remaining:null,resets_at:'2026-09-27T00:00:00Z'});
  await render(<MenuMakerScreen {...props([])} />);
  expect(await screen.findByText('Unlimited menu creation for admins.')).toBeOnTheScreen();
  await fireEvent.press(screen.getByRole('checkbox', {name:'Select Soup'}));
  await fireEvent.press(screen.getByRole('button', {name:'Choose a style'}));
  expect(await screen.findByDisplayValue('Soup')).toBeOnTheScreen();
  expect(mockCreate).toHaveBeenCalledTimes(1);
});
