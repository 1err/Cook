import { PublicDocument } from "../public-site/PublicDocument";
import { publicMetadata } from "../public-site/metadata";

export const metadata = publicMetadata("Contact — Chef World", "Contact Jerry about Chef World, product feedback, privacy requests, or grocery partnerships.", "/contact");

export default function Page() {
  return <PublicDocument kind="contact" />;
}
