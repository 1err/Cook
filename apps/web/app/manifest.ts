import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Chef World",
    short_name: "Chef World",
    description: "Import recipes, plan meals, and build your shopping list.",
    start_url: "/import",
    scope: "/",
    display: "standalone",
    background_color: "#fbf7f1",
    theme_color: "#a64b34",
    icons: [
      { src: "/chefworld-share-icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/chefworld-share-icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    share_target: {
      action: "/share-target",
      method: "POST",
      enctype: "multipart/form-data",
      params: {
        title: "title",
        text: "text",
        url: "url",
        files: [{ name: "video", accept: ["video/mp4", "video/quicktime", "video/webm", ".mp4", ".mov", ".webm"] }],
      },
    },
  };
}
