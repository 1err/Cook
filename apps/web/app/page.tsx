import { HomePage } from "./public-site/HomePage";
import { publicMetadata } from "./public-site/metadata";

export const metadata = publicMetadata(
  "Chef World — A little closer to home",
  "Save recipes, plan meals, simplify grocery shopping, and cook with step-by-step guidance. Chef World brings it all together.",
  "/",
);

export default function Home() {
  return <HomePage />;
}
