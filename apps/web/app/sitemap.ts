import type { MetadataRoute } from "next";
import { PUBLIC_PAGE_PATHS } from "./lib/publicRoutes";

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PAGE_PATHS.map((path) => ({ url: `https://chef-world.com${path}` }));
}
