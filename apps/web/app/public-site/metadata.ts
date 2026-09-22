import type { Metadata } from "next";

const SITE_ORIGIN = "https://chef-world.com";

export function publicMetadata(title: string, description: string, path: string): Metadata {
  const url = `${SITE_ORIGIN}${path}`;
  return {
    title,
    description,
    alternates: { canonical: url },
    openGraph: { title, description, url, siteName: "Chef World", type: "website" },
  };
}
