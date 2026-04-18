import type { Metadata } from "next";
import "./globals.css";
import { AuthProvider } from "./lib/auth";
import { Header } from "./components/Header";

export const metadata: Metadata = {
  title: "Cooking — Recipe library & planner",
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
        <AuthProvider>
          <Header />
          <main>{children}</main>
        </AuthProvider>
      </body>
    </html>
  );
}
