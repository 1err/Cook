import { extractSharedVideoUrl } from "./sharedVideoUrl";

describe("extractSharedVideoUrl", () => {
  it.each([
    [
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
      "https://youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    [
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    [
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    [
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
      "https://music.youtube.com/watch?v=dQw4w9WgXcQ",
    ],
    [
      "https://youtube.com/shorts/dQw4w9WgXcQ",
      "https://youtube.com/shorts/dQw4w9WgXcQ",
    ],
    [
      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
      "https://www.youtube.com/live/dQw4w9WgXcQ?feature=share",
    ],
    [
      "https://m.youtube.com/embed/dQw4w9WgXcQ",
      "https://m.youtube.com/embed/dQw4w9WgXcQ",
    ],
    ["https://youtu.be/dQw4w9WgXcQ?t=10", "https://youtu.be/dQw4w9WgXcQ?t=10"],
    [
      "https://youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ],
    [
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
      "https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ",
    ],
    [
      "https://www.tiktok.com/@chef/video/7412345678901234567?is_from_webapp=1",
      "https://www.tiktok.com/@chef/video/7412345678901234567?is_from_webapp=1",
    ],
    [
      "https://m.tiktok.com/@chef/video/7412345678901234567",
      "https://m.tiktok.com/@chef/video/7412345678901234567",
    ],
    ["https://vm.tiktok.com/ZMexample/", "https://vm.tiktok.com/ZMexample/"],
    ["https://vt.tiktok.com/ZSexample_1", "https://vt.tiktok.com/ZSexample_1"],
    ["https://www.tiktok.com/t/ZTexample-2/", "https://www.tiktok.com/t/ZTexample-2/"],
    ["https://youtu.be:443/dQw4w9WgXcQ", "https://youtu.be/dQw4w9WgXcQ"],
  ])("accepts every backend-supported video URL form", (input, expected) => {
    expect(extractSharedVideoUrl(input, null)).toBe(expected);
  });

  it.each([
    "https://youtube.com/",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=dQw4w9WgXc",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQx",
    "https://www.youtube.com/v/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/dQw4w9WgXcQ/extra",
    "https://youtu.be/dQw4w9WgXc",
    "https://youtube-nocookie.com/watch?v=dQw4w9WgXcQ",
    "https://tiktok.com/@chef/video/7412345678901234567",
    "https://www.tiktok.com/",
    "https://www.tiktok.com/@chef/photo/7412345678901234567",
    "https://www.tiktok.com/@chef/video/not-digits",
    "https://vm.tiktok.com/",
    "https://vm.tiktok.com/ZMexample/extra",
    "https://www.tiktok.com/t/",
    "https://www.tiktok.com/t/ZTexample/extra",
    "https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ",
    "https://tiktok.com.evil.test/@chef/video/7412345678901234567",
    "https://user@www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://user:secret@www.tiktok.com/@chef/video/7412345678901234567",
    "https://www.youtube.com:444/watch?v=dQw4w9WgXcQ",
  ])("rejects backend-unsupported or unsafe video URLs", (input) => {
    expect(extractSharedVideoUrl(input, null)).toBeNull();
  });

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

  it.each([
    ["http://youtu.be/dQw4w9WgXcQ", null],
    [null, "Watch http://www.tiktok.com/@chef/video/7412345678901234567"],
  ])("rejects insecure shared video URLs", (webUrl, text) => {
    expect(extractSharedVideoUrl(webUrl, text)).toBeNull();
  });

  it("continues scanning shared text after an invalid candidate", () => {
    expect(
      extractSharedVideoUrl(
        null,
        "Skip https://www.youtube.com/v/dQw4w9WgXcQ and use https://youtu.be/dQw4w9WgXcQ instead.",
      ),
    ).toBe("https://youtu.be/dQw4w9WgXcQ");
  });
});
