// An active service worker receives share POSTs on-device. Never buffer a video
// in a Next/Vercel route: their payload limit is smaller than supported videos.
export async function POST(): Promise<Response> {
  return new Response("Open Chef World once in your installed app, then share again. You can also import a link or video at /import.", {
    status: 503,
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}

export async function GET(): Promise<Response> {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Share to Chef World</title><body><main><h1>Share to Chef World</h1><p>Install Chef World from Chrome on Android, open it once, then select Chef World from another app's Share menu.</p><p>Sharing a video requires the source app to send the video file. If it sends a link, Chef World will open the link importer.</p><p>iPhone and iPad websites cannot receive shares from the system Share menu.</p><p><a href="/import">Open recipe importer</a></p></main></body></html>`, {
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}
