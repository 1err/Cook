import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError } from "./index";
import {
  resolveMenuArtwork,
  type GenerateMenuArtworkPayload,
  type MenuArtworkClient,
  type MenuArtworkResult,
} from "./menuArtwork";

const payload = Object.freeze({
  request_id: "menu/request 1",
  style_id: "cozy-cafe",
  instructions: "Tiny tomatoes",
}) as GenerateMenuArtworkPayload;

const completed: MenuArtworkResult = {
  request_id: payload.request_id,
  status: "completed",
  file_url: `/menus/artwork/${payload.request_id}/file`,
};

const pending: MenuArtworkResult = {
  request_id: payload.request_id,
  status: "pending",
  file_url: null,
};

function mockClient(overrides: Partial<MenuArtworkClient> = {}): MenuArtworkClient {
  return {
    artworkAccess: vi.fn(),
    generateArtwork: vi.fn().mockResolvedValue(completed),
    artworkStatus: vi.fn().mockResolvedValue(completed),
    artworkFile: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("resolveMenuArtwork", () => {
  test("recovers a lost POST response by checking the same request without replaying it", async () => {
    vi.useFakeTimers();
    const client = mockClient({
      generateArtwork: vi.fn().mockRejectedValue(new TypeError("Connection lost")),
      artworkStatus: vi.fn().mockResolvedValue(completed),
    });

    await expect(resolveMenuArtwork(client, payload, {
      mode: "generate",
      signal: new AbortController().signal,
    })).resolves.toEqual(completed);

    expect(client.generateArtwork).toHaveBeenCalledOnce();
    expect(client.generateArtwork).toHaveBeenCalledWith(payload, { signal: expect.any(AbortSignal) });
    expect(client.artworkStatus).toHaveBeenCalledWith(payload.request_id, { signal: expect.any(AbortSignal) });
  });

  test("polls pending status every two seconds until the request becomes terminal", async () => {
    vi.useFakeTimers();
    const client = mockClient({
      generateArtwork: vi.fn().mockResolvedValue(pending),
      artworkStatus: vi.fn()
        .mockResolvedValueOnce(pending)
        .mockResolvedValueOnce(completed),
    });

    const result = resolveMenuArtwork(client, payload, {
      mode: "generate",
      signal: new AbortController().signal,
    });
    await Promise.resolve();
    expect(client.artworkStatus).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_999);
    expect(client.artworkStatus).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(client.artworkStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(result).resolves.toEqual(completed);
    expect(client.artworkStatus).toHaveBeenCalledTimes(2);
    expect(client.generateArtwork).toHaveBeenCalledTimes(1);
  });

  test("returns failed terminal states without polling", async () => {
    vi.useFakeTimers();
    const failed: MenuArtworkResult = {
      request_id: payload.request_id,
      status: "failed",
      file_url: null,
      error_code: "provider_failed",
    };
    const client = mockClient({ generateArtwork: vi.fn().mockResolvedValue(failed) });

    await expect(resolveMenuArtwork(client, payload, {
      mode: "generate",
      signal: new AbortController().signal,
    })).resolves.toEqual(failed);
    expect(client.artworkStatus).not.toHaveBeenCalled();
  });

  test("aborts a pending recovery and schedules no later status checks", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const client = mockClient({ generateArtwork: vi.fn().mockResolvedValue(pending) });

    const result = resolveMenuArtwork(client, payload, {
      mode: "generate",
      signal: controller.signal,
    });
    await Promise.resolve();
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.artworkStatus).not.toHaveBeenCalled();
  });

  test("rejects promptly when an in-flight client call does not settle after abort", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const client = mockClient({
      generateArtwork: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    });
    const result = resolveMenuArtwork(client, payload, {
      mode: "generate",
      signal: controller.signal,
    });
    const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });

    controller.abort();
    await rejection;
  });

  test("explicit check replays the exact immutable payload after a missing status", async () => {
    vi.useFakeTimers();
    const client = mockClient({
      artworkStatus: vi.fn().mockRejectedValue(new ApiError("Missing", 404, "not_found")),
      generateArtwork: vi.fn().mockResolvedValue(completed),
    });

    await expect(resolveMenuArtwork(client, payload, {
      mode: "check",
      signal: new AbortController().signal,
    })).resolves.toEqual(completed);

    expect(client.artworkStatus).toHaveBeenCalledOnce();
    expect(client.generateArtwork).toHaveBeenCalledOnce();
    expect(vi.mocked(client.generateArtwork).mock.calls[0][0]).toEqual(payload);
    expect(vi.mocked(client.generateArtwork).mock.calls[0][0]).not.toBe(payload);
    expect(vi.mocked(client.generateArtwork).mock.calls[0][0].request_id).toBe(payload.request_id);
  });

  test("snapshots the original payload before awaiting a missing-status check", async () => {
    let rejectStatus!: (error: unknown) => void;
    const mutablePayload: GenerateMenuArtworkPayload = {
      request_id: "original-request",
      style_id: "cozy-cafe",
      instructions: "Original instructions",
    };
    const client = mockClient({
      artworkStatus: vi.fn().mockImplementationOnce(() => new Promise((_resolve, reject) => {
        rejectStatus = reject;
      })),
      generateArtwork: vi.fn().mockResolvedValue({
        request_id: "original-request",
        status: "completed",
        file_url: "/menus/artwork/original-request/file",
      }),
    });

    const result = resolveMenuArtwork(client, mutablePayload, {
      mode: "check",
      signal: new AbortController().signal,
    });
    mutablePayload.request_id = "changed-request";
    mutablePayload.style_id = "minimal-modern";
    mutablePayload.instructions = "Changed instructions";
    rejectStatus(new ApiError("Missing", 404, "not_found"));

    await expect(result).resolves.toMatchObject({ request_id: "original-request" });
    expect(client.artworkStatus).toHaveBeenCalledWith(
      "original-request",
      { signal: expect.any(Object) },
    );
    expect(client.generateArtwork).toHaveBeenCalledWith(
      {
        request_id: "original-request",
        style_id: "cozy-cafe",
        instructions: "Original instructions",
      },
      { signal: expect.any(Object) },
    );
  });

  test("automatic recovery never replays a POST when status is missing", async () => {
    vi.useFakeTimers();
    const missing = new ApiError("Missing", 404, "not_found");
    const client = mockClient({
      generateArtwork: vi.fn().mockRejectedValue(new TypeError("Connection lost")),
      artworkStatus: vi.fn().mockRejectedValue(missing),
    });

    await expect(resolveMenuArtwork(client, payload, {
      mode: "generate",
      signal: new AbortController().signal,
    })).rejects.toBe(missing);
    expect(client.generateArtwork).toHaveBeenCalledTimes(1);
  });

  test("propagates a 409 conflict without probing or replaying the request", async () => {
    vi.useFakeTimers();
    const conflict = new ApiError("Request ID conflict", 409, "request_conflict");
    const client = mockClient({ generateArtwork: vi.fn().mockRejectedValue(conflict) });

    await expect(resolveMenuArtwork(client, payload, {
      mode: "generate",
      signal: new AbortController().signal,
    })).rejects.toBe(conflict);
    expect(client.generateArtwork).toHaveBeenCalledTimes(1);
    expect(client.artworkStatus).not.toHaveBeenCalled();
  });

  test("ends pending recovery at the 90-second deadline", async () => {
    vi.useFakeTimers();
    const client = mockClient({
      generateArtwork: vi.fn().mockResolvedValue(pending),
      artworkStatus: vi.fn().mockResolvedValue(pending),
    });
    const result = resolveMenuArtwork(client, payload, {
      mode: "generate",
      signal: new AbortController().signal,
    });
    const rejection = expect(result).rejects.toMatchObject({ name: "AbortError" });

    await vi.advanceTimersByTimeAsync(90_000);
    await rejection;
    const callsAtDeadline = vi.mocked(client.artworkStatus).mock.calls.length;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.artworkStatus).toHaveBeenCalledTimes(callsAtDeadline);
  });

  test("uses a platform-neutral abort error when the signal has no reason and DOMException is absent", async () => {
    vi.useFakeTimers();
    class NativeLikeSignal {
      aborted = false;
      private listeners = new Set<EventListenerOrEventListenerObject>();

      addEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
        this.listeners.add(listener);
      }

      removeEventListener(_type: string, listener: EventListenerOrEventListenerObject): void {
        this.listeners.delete(listener);
      }

      dispatchAbort(): void {
        this.aborted = true;
        const event = {} as Event;
        for (const listener of [...this.listeners]) {
          if (typeof listener === "function") listener(event);
          else listener.handleEvent(event);
        }
      }
    }
    class NativeLikeAbortController {
      readonly signal = new NativeLikeSignal();
      abort(): void {
        this.signal.dispatchAbort();
      }
    }
    vi.stubGlobal("DOMException", undefined);
    vi.stubGlobal("AbortController", NativeLikeAbortController);
    const client = mockClient({
      generateArtwork: vi.fn().mockImplementation(() => new Promise(() => undefined)),
    });
    const controller = new NativeLikeAbortController();
    const result = resolveMenuArtwork(client, payload, {
      mode: "generate",
      signal: controller.signal as unknown as AbortSignal,
    });
    const rejection = expect(result).rejects.toMatchObject({
      name: "AbortError",
      message: "Menu artwork request timed out",
    });

    await vi.advanceTimersByTimeAsync(90_000);
    await rejection;
  });
});

test('artwork recovery retains the original nested visual design', async () => {
  const { menuDesignForStyle } = await import('@cooking/shared');
  const input: GenerateMenuArtworkPayload = { ...payload, design: menuDesignForStyle('cozy-cafe') };
  const original = JSON.parse(JSON.stringify(input));
  let missing!: (error: unknown) => void;
  const client = mockClient({ artworkStatus: vi.fn().mockImplementation(() => new Promise((_, reject) => { missing = reject; })) });
  const request = resolveMenuArtwork(client, input, { mode: 'check', signal: new AbortController().signal });
  input.design!.palette.accent = '#000000'; input.design!.columns = 3;
  missing(new ApiError('missing', 404, 'not_found'));
  await request;
  expect(client.generateArtwork).toHaveBeenCalledWith(original, { signal: expect.any(AbortSignal) });
});
