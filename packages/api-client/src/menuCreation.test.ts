import { afterEach, expect, test, vi } from 'vitest';
import { ApiError, createApiClient } from './index';

afterEach(() => vi.unstubAllGlobals());

test('admits a menu session using authenticated cookie requests and the original request ID', async () => {
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify({ request_id: 'original-request' })));
  vi.stubGlobal('fetch', fetcher);
  const client = createApiClient({ baseUrl: 'https://api.example', auth: { kind: 'cookie' } });
  const signal = new AbortController().signal;
  await client.menus.access({ signal });
  await client.menus.create({ request_id: 'original-request' }, { signal });
  expect(fetcher.mock.calls[0]).toEqual(['https://api.example/menus/access', expect.objectContaining({ credentials: 'include', signal })]);
  expect(fetcher.mock.calls[1]).toEqual(['https://api.example/menus/creations', expect.objectContaining({ credentials: 'include', method: 'POST', body: '{"request_id":"original-request"}', signal })]);
});

test('native creation uses bearer auth and preserves the daily-limit rejection', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ detail: { code: 'menu_daily_limit', message: 'Daily limit reached' } }), { status: 429 }));
  vi.stubGlobal('fetch', fetcher);
  const client = createApiClient({ baseUrl: 'https://api.example', auth: { kind: 'bearer', getToken: () => 'native-token' } });
  await expect(client.menus.create({ request_id: 'original-request' })).rejects.toMatchObject({ status: 429, code: 'menu_daily_limit' } satisfies Partial<ApiError>);
  const options = fetcher.mock.calls[0][1];
  expect(options.credentials).toBe('omit');
  expect(options.headers.get('Authorization')).toBe('Bearer native-token');
});
