import { afterEach, expect, test, vi } from "vitest";
import { createApiClient, recipePageQuery } from "./index";
afterEach(() => vi.unstubAllGlobals());
test("author filter composes with text tags and pagination", () => {
  const params = new URLSearchParams(recipePageQuery({ authorId: "creator-1", q: "tofu", tags: ["chinese"], cursor: "next" }));
  expect(params.get("author_id")).toBe("creator-1");
  expect(params.get("q")).toBe("tofu");
  expect(params.getAll("tags")).toEqual(["chinese"]);
  expect(params.get("cursor")).toBe("next");
});
test("lookup and explicit create preserve authentication and cancellation", async () => {
  const author = { id: "wang", name: "美食作家王刚", aliases: ["Chef Wang"] };
  const fetcher = vi.fn().mockImplementation((_url, options) => Promise.resolve(new Response(JSON.stringify(options.method === "POST" ? author : [author]))));
  vi.stubGlobal("fetch", fetcher);
  const api = createApiClient({ baseUrl: "https://api.example", auth: { kind: "cookie" } });
  const signal = new AbortController().signal;
  expect(await api.recipes.authors({ q: "王刚", limit: 20, signal })).toEqual([author]);
  expect(await api.recipes.createAuthor({ name: author.name, aliases: author.aliases }, { signal })).toEqual(author);
  const first = new URL(fetcher.mock.calls[0][0]);
  expect(first.pathname).toBe("/recipes/authors");
  expect(first.searchParams.get("q")).toBe("王刚");
  expect(fetcher.mock.calls[0][1].credentials).toBe("include");
  expect(fetcher.mock.calls[0][1].signal).toBe(signal);
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ name: author.name, aliases: author.aliases });
});
