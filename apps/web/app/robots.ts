import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: ["/", "/about", "/privacy", "/terms", "/contact"],
      disallow: ["/login", "/register", "/library", "/planner", "/cook", "/shopping-list", "/import", "/recipe", "/settings", "/preview"],
    },
    sitemap: "https://chef-world.com/sitemap.xml",
  };
}
