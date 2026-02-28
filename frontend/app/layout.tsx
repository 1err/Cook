import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Cooking Recipe Planner",
  description: "From video to meal plan to shopping list",
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
          href="https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;1,9..40,400&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <nav style={navStyle}>
          <a href="/">Import</a>
          <a href="/library">Library</a>
          <a href="/planner">Planner</a>
          <a href="/shopping-list">Shopping list</a>
        </nav>
        <main style={mainStyle}>{children}</main>
      </body>
    </html>
  );
}

const navStyle: React.CSSProperties = {
  borderBottom: "1px solid var(--border)",
  padding: "var(--space-16) var(--space-24)",
  display: "flex",
  gap: "var(--space-24)",
  background: "var(--bg)",
};

const mainStyle: React.CSSProperties = {
  maxWidth: 720,
  margin: "0 auto",
  padding: "var(--space-32) var(--space-24)",
  paddingBottom: "calc(var(--space-32) + 88px)",
};
