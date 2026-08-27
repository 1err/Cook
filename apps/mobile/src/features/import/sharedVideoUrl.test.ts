import { extractSharedVideoUrl } from "./sharedVideoUrl";

describe("extractSharedVideoUrl", () => {
  it.each([
    ["https://youtu.be/dQw4w9WgXcQ", null, "https://youtu.be/dQw4w9WgXcQ"],
    [
      null,
      "Try this https://vm.tiktok.com/ZMrecipe/ from TikTok",
      "https://vm.tiktok.com/ZMrecipe/",
    ],
    ["https://example.com/video", null, null],
    [null, "no link", null],
  ])("extracts only supported shared video URLs", (webUrl, text, expected) => {
    expect(extractSharedVideoUrl(webUrl, text)).toBe(expected);
  });

  it("preserves query strings while removing trailing prose punctuation", () => {
    expect(
      extractSharedVideoUrl(
        null,
        "Watch https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share, please.",
      ),
    ).toBe("https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=share");
  });

  it("rejects lookalike and unsupported protocols", () => {
    expect(extractSharedVideoUrl("https://youtube.com.example.com/watch?v=abc", null)).toBeNull();
    expect(extractSharedVideoUrl("ftp://youtu.be/dQw4w9WgXcQ", null)).toBeNull();
  });
});
