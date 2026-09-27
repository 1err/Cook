import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { MenuMakerScreen } from './MenuMakerScreen';

let mockAccount = 'a';
let mockGuard: { enabled: boolean; callback: (event: any) => void };
const mockList = jest.fn();
const mockAccess = jest.fn();
const mockGenerate = jest.fn();
const mockStatus = jest.fn();
const mockFile = jest.fn();
const mockCreate = jest.fn();
const mockArtworkAccess = jest.fn();
const mockShare = jest.fn();
const mockApi = { recipes: { list: mockList }, menus: { access: mockAccess, create: mockCreate, artworkAccess: mockArtworkAccess, generateArtwork: mockGenerate, artworkStatus: mockStatus, artworkFile: mockFile } };
const mockTranslate = (key: string, variables?: Record<string, string | number>) => {
  const { MESSAGE_MAP } = require('@cooking/shared');
  return (MESSAGE_MAP.en[key] ?? key).replace(/\{(\w+)\}/g, (_: string, token: string) => String(variables?.[token] ?? ''));
};
const label = (key: string) => mockTranslate(key === 'search' ? 'library.searchAria' : `menu.simple.${key === 'limit' ? 'recipeLimit' : key === 'result' ? 'imageAlt' : key}`);
jest.mock('../../lib/i18n', () => ({ useT: () => mockTranslate }));
jest.mock('../../lib/api', () => ({ useApiClient: () => mockApi }));
jest.mock('../../lib/auth', () => ({ useAuth: () => ({ user: { id: mockAccount } }) }));
jest.mock('@react-navigation/native', () => ({ UNSTABLE_usePreventRemove: (enabled: boolean, callback: any) => { mockGuard = { enabled, callback }; } }));
jest.mock('./menuAssets', () => ({ artworkResponseDataUrl: jest.fn(async () => 'data:image/png;base64,iVBORw0KGgo=') }));
jest.mock('./menuExport', () => ({ shareMenuPng: (...args: any[]) => mockShare(...args), SharingUnavailableError: class extends Error {} }));
const recipes = [{ id: 'one', title: 'Noodles', description: 'Sesame', thumbnail_url: 'https://example.com/noodles.png' }, { id: 'two', title: 'Soup', description: 'Ginger' }];
const navigation = { dispatch: jest.fn(), goBack: jest.fn(), setOptions: jest.fn() };
const props = (ids = ['one']) => ({ navigation: navigation as never, route: { key: 'menu', name: 'MenuMaker' as const, params: { recipeIds: ids } } });
beforeEach(() => {
  jest.clearAllMocks(); mockAccount = 'a';
  mockList.mockReset().mockResolvedValue(recipes);
  mockAccess.mockReset().mockResolvedValue({ allowed: true, is_admin: false, daily_limit: 1, remaining: 1, resets_at: '2026-09-28T00:00:00Z' });
  mockArtworkAccess.mockReset().mockResolvedValue({ enabled: true, allowed: true, remaining: 2, daily_limit: 3, reason: null });
  mockGenerate.mockReset().mockImplementation(async payload => ({ request_id: payload.request_id, status: 'completed' }));
  mockStatus.mockReset(); mockFile.mockReset().mockResolvedValue({}); mockShare.mockReset().mockResolvedValue(undefined);
});

test('opens one compact form without admitting a menu or showing design controls', async () => {
  await render(<MenuMakerScreen {...props()} />);
  expect(await screen.findByRole('checkbox', { name: 'Select Noodles' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Select Soup' })).not.toBeChecked();
  expect(screen.getByLabelText(label('title'))).toHaveDisplayValue('');
  expect(screen.getByLabelText(label('brief'))).toHaveDisplayValue('');
  expect(screen.queryByText('Choose a style')).toBeNull();
  expect(mockCreate).not.toHaveBeenCalled(); expect(mockGenerate).not.toHaveBeenCalled();
});

test('one Generate submits only checked dish names plus optional user direction and shares the full PNG', async () => {
  await render(<MenuMakerScreen {...props()} />);
  await screen.findByRole('checkbox', { name: 'Select Noodles' });
  await fireEvent.changeText(screen.getByLabelText(label('title')), ' Our little kitchen ');
  await fireEvent.changeText(screen.getByLabelText(label('brief')), ' Cute tomatoes, warm Chinese lettering ');
  await fireEvent.press(screen.getByRole('button', { name: label('generate') }));
  expect(await screen.findByLabelText(label('result'))).toBeOnTheScreen();
  expect(mockCreate).not.toHaveBeenCalled(); expect(mockGenerate).toHaveBeenCalledTimes(1);
  expect(mockGenerate.mock.calls[0][0]).toEqual({ request_id: expect.any(String), mode: 'full-menu-v1', title: 'Our little kitchen', brief: 'Cute tomatoes, warm Chinese lettering', recipes: [{ recipe_id: 'one', name: 'Noodles' }] });
  await fireEvent.press(screen.getByRole('button', { name: label('share') }));
  expect(mockShare).toHaveBeenCalledWith('data:image/png;base64,iVBORw0KGgo=', expect.any(AbortSignal));
  expect(recipes[0].title).toBe('Noodles');
});

test('search is only a view filter; Select all includes the full library and Clear removes it', async () => {
  await render(<MenuMakerScreen {...props([])} />);
  await screen.findByRole('checkbox', { name: 'Select Noodles' });
  await fireEvent.changeText(screen.getByLabelText(label('search')), 'Soup');
  expect(screen.queryByRole('checkbox', { name: 'Select Noodles' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Select all recipes' }));
  await fireEvent.changeText(screen.getByLabelText(label('search')), '');
  expect(screen.getByRole('checkbox', { name: 'Select Noodles' })).toBeChecked();
  expect(screen.getByRole('checkbox', { name: 'Select Soup' })).toBeChecked();
  await fireEvent.press(screen.getByRole('button', { name: 'Clear selection' }));
  expect(screen.getByRole('button', { name: label('generate') })).toBeDisabled();
});

test('Select all never silently truncates a large library and generating over 24 is blocked', async () => {
  mockList.mockResolvedValue(Array.from({ length: 25 }, (_, index) => ({ id: String(index), title: `Dish ${index}` })));
  await render(<MenuMakerScreen {...props([])} />);
  await screen.findByRole('checkbox', { name: 'Select Dish 0' });
  await fireEvent.press(screen.getByRole('button', { name: 'Select all recipes' }));
  expect(screen.getAllByRole('checkbox').filter(node => node.props.accessibilityState.checked)).toHaveLength(25);
  expect(screen.getByText(mockTranslate('menu.simple.recipeLimit', { limit: 24 }))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: label('generate') })).toBeDisabled();
  expect(mockGenerate).not.toHaveBeenCalled();
});

test('missing selected IDs require fixing selection instead of silently omitting a dish', async () => {
  await render(<MenuMakerScreen {...props(['one', 'missing'])} />);
  expect(await screen.findByText(mockTranslate('menu.selection.missingRecipes'))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: label('generate') })).toBeDisabled();
  await fireEvent.press(screen.getByRole('button', { name: 'Select all recipes' }));
  expect(screen.getByRole('button', { name: label('generate') })).toBeEnabled();
});

test('empty library cannot generate and explains how to begin', async () => {
  mockList.mockResolvedValue([]);
  await render(<MenuMakerScreen {...props([])} />);
  expect(await screen.findByText('Import a recipe to make your first menu.')).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: label('generate') })).toBeDisabled();
});

test('daily access is read-only until Generate and a server rejection preserves the form', async () => {
  mockGenerate.mockRejectedValue({ status: 429, code: 'menu_daily_limit' });
  await render(<MenuMakerScreen {...props()} />);
  await screen.findByRole('checkbox', { name: 'Select Noodles' });
  await fireEvent.changeText(screen.getByLabelText(label('title')), 'Dinner');
  await fireEvent.press(screen.getByRole('button', { name: label('generate') }));
  expect(await screen.findByText(/You’ve created today’s menu/)).toBeOnTheScreen();
  expect(screen.getByLabelText(label('title'))).toHaveDisplayValue('Dinner');
  expect(mockCreate).not.toHaveBeenCalled(); expect(mockGenerate).toHaveBeenCalledTimes(1);
});

test('cancel keeps the original form locked and status recovery reuses the original request', async () => {
  let complete!: (value: unknown) => void;
  mockGenerate.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  await render(<MenuMakerScreen {...props()} />);
  await screen.findByRole('checkbox', { name: 'Select Noodles' });
  await fireEvent.changeText(screen.getByLabelText(label('title')), 'Original');
  await fireEvent.press(screen.getByRole('button', { name: label('generate') }));
  const request = mockGenerate.mock.calls[0][0];
  await fireEvent.press(screen.getByRole('button', { name: label('cancel') }));
  expect(screen.getByLabelText(label('title'))).toBeDisabled();
  mockStatus.mockResolvedValue({ request_id: request.request_id, status: 'completed' });
  await fireEvent.press(screen.getByRole('button', { name: label('check') }));
  expect(await screen.findByLabelText(label('result'))).toBeOnTheScreen();
  expect(mockStatus.mock.calls[0][0]).toBe(request.request_id);
  expect(mockGenerate).toHaveBeenCalledTimes(1);
  expect(mockGenerate.mock.calls[0][0].title).toBe('Original');
  await act(async () => complete({ request_id: request.request_id, status: 'completed' }));
  expect(mockFile).toHaveBeenCalledTimes(1);
});

test('account change discards private form, selection, and late generation result', async () => {
  let complete!: (value: unknown) => void;
  mockGenerate.mockReturnValue(new Promise(resolve => { complete = resolve; }));
  const view = await render(<MenuMakerScreen {...props()} />);
  await screen.findByRole('checkbox', { name: 'Select Noodles' });
  await fireEvent.changeText(screen.getByLabelText(label('title')), 'Private dinner');
  await fireEvent.press(screen.getByRole('button', { name: label('generate') }));
  const request = mockGenerate.mock.calls[0][0];
  mockAccount = 'b'; mockList.mockResolvedValue([{ id: 'three', title: 'Rice' }]);
  await view.rerender(<MenuMakerScreen {...props()} />);
  expect(await screen.findByRole('checkbox', { name: 'Select Rice' })).not.toBeChecked();
  expect(screen.getByLabelText(label('title'))).toHaveDisplayValue('');
  await act(async () => complete({ request_id: request.request_id, status: 'completed' }));
  expect(screen.queryByLabelText(label('result'))).toBeNull(); expect(mockFile).not.toHaveBeenCalled();
});

test('leaving a generated or edited session requires confirmation and can retain it', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<MenuMakerScreen {...props()} />);
  await screen.findByRole('checkbox', { name: 'Select Noodles' });
  await fireEvent.changeText(screen.getByLabelText(label('title')), 'Dinner');
  expect(mockGuard.enabled).toBe(true);
  const action = { type: 'GO_BACK' };
  await act(async () => mockGuard.callback({ data: { action } }));
  const buttons = alert.mock.calls[0][2]!;
  expect(navigation.dispatch).not.toHaveBeenCalled();
  expect(screen.getByLabelText(label('title'))).toHaveDisplayValue('Dinner');
  await act(async () => buttons[1].onPress?.());
  expect(navigation.dispatch).toHaveBeenCalledWith(action);
  alert.mockRestore();
});

test('completed menus consume the local nonadmin allowance even if a subsequent access response is stale', async () => {
  await render(<MenuMakerScreen {...props()} />);
  await screen.findByRole('checkbox', { name: 'Select Noodles' });
  await fireEvent.press(screen.getByRole('button', { name: label('generate') }));
  await screen.findByLabelText(label('result'));
  await waitFor(() => expect(screen.getByRole('button', { name: label('generate') })).toBeDisabled());
  expect(screen.getByRole('button', { name: label('share') })).toBeEnabled();
});
test('provider access failure explains a disabled generation button without claiming daily exhaustion', async () => {
  mockArtworkAccess.mockResolvedValue({ enabled: true, allowed: false, remaining: 2, daily_limit: 3, reason: 'global_limit' });
  await render(<MenuMakerScreen {...props()} />);
  expect(await screen.findByText(mockTranslate('menu.simple.unavailable'))).toBeOnTheScreen();
  expect(screen.getByRole('button', { name: label('generate') })).toBeDisabled();
  expect(screen.queryByText(/You’ve created today’s menu/)).toBeNull();
});

test('server-reported library changes unlock selection and expose a refresh before generation', async () => {
  mockGenerate.mockRejectedValueOnce({ status: 404, code: 'recipe_not_found' });
  await render(<MenuMakerScreen {...props()} />);
  await screen.findByRole('checkbox', { name: 'Select Noodles' });
  await fireEvent.press(screen.getByRole('button', { name: label('generate') }));
  expect(await screen.findByText(label('selectionChanged'))).toBeOnTheScreen();
  expect(screen.getByRole('checkbox', { name: 'Select Noodles' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: label('check') })).toBeNull();
  mockList.mockResolvedValue([{ id: 'one', title: 'Updated noodles' }]);
  await fireEvent.press(screen.getByRole('button', { name: mockTranslate('common.refresh') }));
  expect(await screen.findByRole('checkbox', { name: 'Select Updated noodles' })).toBeChecked();
  await fireEvent.press(screen.getByRole('button', { name: label('generate') }));
  expect(mockGenerate.mock.calls[1][0].recipes).toEqual([{ recipe_id: 'one', name: 'Updated noodles' }]);
});
