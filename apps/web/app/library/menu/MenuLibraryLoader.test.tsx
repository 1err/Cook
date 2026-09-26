import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MenuLibraryLoader } from './MenuLibraryLoader';
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock('../../lib/api', () => ({ webApiClient: { recipes: { list: mocks.list } } }));
vi.mock('../../lib/i18n', () => ({ useT: () => (key: string) => key }));
vi.mock('./MenuMaker', () => ({ MenuMaker: ({ recipes, initialSearch }: { recipes: {id: string}[]; initialSearch?: string }) => <div data-testid="loaded-menu">{recipes.map(recipe => recipe.id).join(',')}|{initialSearch}</div> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('complete library menu selection', () => {
  it('loads the complete owned library without applying the browsing filters', async () => {
    mocks.list.mockResolvedValue([{id:'page-one'}, {id:'page-two'}, {id:'outside-search'}]);
    render(<MenuLibraryLoader initialSearch="Soup" initialFilters={['chinese']} onClose={vi.fn()} />);
    expect(await screen.findByTestId('loaded-menu')).toHaveTextContent('page-one,page-two,outside-search|Soup');
    expect(mocks.list).toHaveBeenCalledWith();
  });
  it('supports retry after a failed library load', async () => {
    mocks.list.mockRejectedValueOnce(new Error('Offline')).mockResolvedValueOnce([]);
    render(<MenuLibraryLoader onClose={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('menu.selection.loadFailed');
    fireEvent.click(screen.getByRole('button', {name:'menu.retry'}));
    expect(await screen.findByTestId('loaded-menu')).toBeVisible();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it('does not mount a private menu after closing during a request', async () => {
    let finish!: (rows: {id: string}[]) => void;
    mocks.list.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
    const view = render(<MenuLibraryLoader onClose={vi.fn()} />);
    view.unmount();
    finish([{id:'previous-account'}]);
    expect(screen.queryByTestId('loaded-menu')).toBeNull();
  });
});
