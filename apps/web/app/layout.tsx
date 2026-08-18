import type { Metadata } from "next";
import "@fontsource/inter/400.css";
import "@fontsource/inter/500.css";
import "@fontsource/inter/600.css";
import "@fontsource/inter/700.css";
import "@fontsource/inter/800.css";
import "@fontsource/inter/900.css";
import "@fontsource/source-serif-4/400.css";
import "@fontsource/source-serif-4/600.css";
import "@cooking/design-tokens/tokens.css";
import "./globals.css";
import "./styles/foundation.css";
import { AuthProvider } from "./lib/auth";
import { Header } from "./components/Header";
import { I18nProvider } from "./lib/i18n";

export const metadata: Metadata = {
  title: "Chef World — Recipe library & planner",
  description: "Import recipes, plan meals, and build your shopping list.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Material+Symbols+Outlined:opsz,wght,FILL,GRAD@24,400,0,0&display=swap"
        />
      </head>
      <body>
        <I18nProvider>
          <AuthProvider>
            <Header />
            <main>{children}</main>
          </AuthProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
