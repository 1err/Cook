import { PublicDocument } from "../public-site/PublicDocument";
import { publicMetadata } from "../public-site/metadata";

export const metadata = publicMetadata("Terms of use — Chef World", "Terms for using Chef World, including accounts, recipe content, AI-assisted features, and retailer links.", "/terms");

export default function Page() {
  return <PublicDocument kind="terms" />;
}
