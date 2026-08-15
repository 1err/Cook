import { expect, test, vi } from "vitest";
import {
  buildVisualProductQueue,
  runOrderedProductQueue,
  type ProductLookupState,
} from "./productLoading";

const product = (name: string) => ({
  name,
  price: "$1",
  image: "",
  url: `https://example.test/${name}`,
});

test("builds the queue from rendered groups without changing the layout", () => {
  const queue = buildVisualProductQueue([
    {
      category: "Pantry & Dry Goods",
      rows: [
        { name: "Rice", checked: false },
        { name: "Soy sauce", checked: true },
        { name: "   ", checked: false },
      ],
    },
    {
      category: "Produce",
      rows: [
        { name: "Bok choy", checked: false },
        { name: " rice ", checked: false },
      ],
    },
  ]);

  expect(queue).toEqual(["Rice", "Bok choy"]);
});

test("starts in queue order and never exceeds four active loads", async () => {
  const started: string[] = [];
  let active = 0;
  let peak = 0;
  const releases: Array<() => void> = [];
  const load = vi.fn(async (key: string) => {
    started.push(key);
    active += 1;
    peak = Math.max(peak, active);
    await new Promise<void>((resolve) => releases.push(resolve));
    active -= 1;
    return [product(key)];
  });

  const promise = runOrderedProductQueue({
    keys: ["a", "b", "c", "d", "e"],
    load,
    onState: vi.fn(),
    onProgress: vi.fn(),
  });

  await vi.waitFor(() => expect(started).toEqual(["a", "b", "c", "d"]));
  releases.shift()?.();
  await vi.waitFor(() => expect(started).toEqual(["a", "b", "c", "d", "e"]));
  releases.splice(0).forEach((release) => release());
  await promise;

  expect(peak).toBe(4);
});

test("clamps an oversized concurrency request to four active loads", async () => {
  const started: string[] = [];
  const releases: Array<() => void> = [];
  const load = vi.fn(async (key: string) => {
    started.push(key);
    await new Promise<void>((resolve) => releases.push(resolve));
    return [product(key)];
  });

  const promise = runOrderedProductQueue({
    keys: ["a", "b", "c", "d", "e"],
    concurrency: 99,
    load,
    onState: vi.fn(),
    onProgress: vi.fn(),
  });

  await vi.waitFor(() => expect(started).toEqual(["a", "b", "c", "d"]));
  releases.shift()?.();
  await vi.waitFor(() => expect(started).toEqual(["a", "b", "c", "d", "e"]));
  releases.splice(0).forEach((release) => release());
  await promise;
});

test("normalizes a non-finite concurrency request to the safe ceiling", async () => {
  const started: string[] = [];
  const releases: Array<() => void> = [];
  const promise = runOrderedProductQueue({
    keys: ["a", "b", "c", "d", "e"],
    concurrency: Number.POSITIVE_INFINITY,
    load: async (key) => {
      started.push(key);
      await new Promise<void>((resolve) => releases.push(resolve));
      return [product(key)];
    },
    onState: vi.fn(),
    onProgress: vi.fn(),
  });

  await vi.waitFor(() => expect(started).toEqual(["a", "b", "c", "d"]));
  releases.shift()?.();
  await vi.waitFor(() => expect(started).toEqual(["a", "b", "c", "d", "e"]));
  releases.splice(0).forEach((release) => release());
  await promise;
});

test("emits one terminal state and progress for each completed lookup", async () => {
  const transitions = new Map<string, ProductLookupState[]>();
  const progress: Array<[number, number]> = [];

  await runOrderedProductQueue({
    keys: ["ready", "none", "broken"],
    load: async (key) => {
      if (key === "ready") return [product(key)];
      if (key === "none") return [];
      throw new Error("Network unavailable");
    },
    onState: (key, state) => {
      transitions.set(key, [...(transitions.get(key) ?? []), state]);
    },
    onProgress: (done, total) => progress.push([done, total]),
  });

  expect(transitions.get("ready")).toEqual([
    { status: "queued" },
    { status: "loading" },
    { status: "success", products: [product("ready")] },
  ]);
  expect(transitions.get("none")).toEqual([
    { status: "queued" },
    { status: "loading" },
    { status: "empty", products: [] },
  ]);
  expect(transitions.get("broken")).toEqual([
    { status: "queued" },
    { status: "loading" },
    { status: "error", error: "Network unavailable" },
  ]);
  expect(progress).toHaveLength(3);
  expect(progress.every(([, total]) => total === 3)).toBe(true);
  expect(progress.map(([done]) => done).sort()).toEqual([1, 2, 3]);
});

test("stops before a new lookup when cancelled without corrupting queued state", async () => {
  let continueLoading = true;
  const transitions = new Map<string, ProductLookupState[]>();
  const load = vi.fn(async (key: string) => {
    continueLoading = false;
    return [product(key)];
  });

  await runOrderedProductQueue({
    keys: ["first", "second"],
    concurrency: 1,
    load,
    onState: (key, state) => {
      transitions.set(key, [...(transitions.get(key) ?? []), state]);
    },
    onProgress: vi.fn(),
    shouldContinue: () => continueLoading,
  });

  expect(load).toHaveBeenCalledTimes(1);
  expect(transitions.get("first")?.map(({ status }) => status)).toEqual([
    "queued",
    "loading",
    "success",
  ]);
  expect(transitions.get("second")).toEqual([{ status: "queued" }]);
});
