import { PublicDocument } from "../public-site/PublicDocument";
import { publicMetadata } from "../public-site/metadata";

export const metadata = publicMetadata("Privacy — Chef World", "How Chef World handles account information, recipes, AI-assisted features, sharing, and privacy requests.", "/privacy");

export default function Page() {
  return <PublicDocument kind="privacy" />;
}
