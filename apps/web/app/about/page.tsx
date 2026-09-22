import { PublicDocument } from "../public-site/PublicDocument";
import { publicMetadata } from "../public-site/metadata";

export const metadata = publicMetadata("About — Chef World", "Discover, save, plan, shop, and cook. Learn how Chef World brings your cooking routine together.", "/about");

export default function Page() {
  return <PublicDocument kind="about" />;
}
