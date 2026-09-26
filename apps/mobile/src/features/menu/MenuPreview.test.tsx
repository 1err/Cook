import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { createMenuDraft, layoutMenu } from '@cooking/shared';
import { MenuPreview } from './MenuPreview';
const mockPost = jest.fn(); const mockInject = jest.fn();
jest.mock('react-native-webview', () => {
  const React = require('react'); const { View } = require('react-native');
  return { WebView: React.forwardRef((props: any, ref: any) => {
    React.useImperativeHandle(ref, () => ({ postMessage: mockPost, injectJavaScript: mockInject }));
    return <View testID="webview" {...props} />;
  }) };
});
jest.mock('../../lib/i18n', () => ({ useT: () => (key: string) => key }));
const draft = createMenuDraft([{ id: 'one', title: '饺子', description: 'Dinner' }], ['one'], { title: 'Menu', section: 'Food' });
const assets = { fonts: [], artworkDataUrl: null };
const ready = (revision: number) => ({ channel: 'chefworld-menu', type: 'ready', revision, pageCount: 1, layout: layoutMenu(draft, text => text.length * 8) });
beforeEach(() => { jest.clearAllMocks(); jest.useFakeTimers(); });
afterEach(() => { jest.useRealTimers(); });
test('keeps initial HTML stable, debounces edits and rejects stale or malformed ready events', async () => {
  const onReady = jest.fn(); const onError = jest.fn();
  const props = { draft, assets, revision: 1, pageIndex: 0, onReady, onError };
  const view = await render(<MenuPreview {...props} />);
  const source = screen.getByTestId('webview').props.source;
  await fireEvent(screen.getByTestId('webview'), 'loadEnd');
  await view.rerender(<MenuPreview {...props} draft={{ ...draft, title: 'New' }} revision={2} />);
  await view.rerender(<MenuPreview {...props} draft={{ ...draft, title: 'Newest' }} revision={3} />);
  expect(screen.getByTestId('webview').props.source).toBe(source);
  await act(async () => jest.advanceTimersByTime(250));
  expect(mockPost).toHaveBeenCalledTimes(1);
  expect(JSON.parse(mockPost.mock.calls[0][0])).toMatchObject({ revision: 3, draft: { title: 'Newest' } });
  expect(JSON.parse(mockPost.mock.calls[0][0]).assets).toBeUndefined();
  await fireEvent(screen.getByTestId('webview'), 'message', { nativeEvent: { data: JSON.stringify(ready(1)) } });
  await fireEvent(screen.getByTestId('webview'), 'message', { nativeEvent: { data: JSON.stringify({ ...ready(3), layout: {} }) } });
  expect(onReady).not.toHaveBeenCalled();
  await fireEvent(screen.getByTestId('webview'), 'message', { nativeEvent: { data: JSON.stringify(ready(3)) } });
  expect(onReady).toHaveBeenCalledWith(expect.objectContaining({ width: 816 }), 3);
});
test('blocks remote/file navigation and disables WebView file and window access', async () => {
  await render(<MenuPreview draft={draft} assets={assets} revision={1} pageIndex={0} onReady={jest.fn()} onError={jest.fn()} />);
  const props = screen.getByTestId('webview').props;
  expect(props.originWhitelist).toEqual(['*']);
  expect(props.onShouldStartLoadWithRequest({ url: 'about:blank' })).toBe(true);
  for (const url of ['https://example.com', 'file:///private/file', 'data:text/html,evil', 'javascript:alert(1)']) expect(props.onShouldStartLoadWithRequest({ url })).toBe(false);
  expect(props.allowFileAccess).toBe(false); expect(props.allowUniversalAccessFromFileURLs).toBe(false);
  expect(props.setSupportMultipleWindows).toBe(false); expect(props.javaScriptCanOpenWindowsAutomatically).toBe(false);
  expect(props.source.html).toContain("connect-src 'none'");
});
