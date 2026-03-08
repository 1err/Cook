"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useAuth } from "../lib/auth";

export function NavAuth() {
  const { user, loading, logout } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener("click", handleClickOutside);
      return () => document.removeEventListener("click", handleClickOutside);
    }
  }, [dropdownOpen]);

  if (loading) {
    return <span style={loadingStyle}>...</span>;
  }

  if (!user) {
    return (
      <div style={authLinksStyle}>
        <Link href="/login" style={linkStyle}>
          Login
        </Link>
        <Link href="/register" style={linkStyle}>
          Register
        </Link>
      </div>
    );
  }

  const initial = user.email.charAt(0).toUpperCase();

  return (
    <div style={avatarWrapStyle} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setDropdownOpen((o) => !o)}
        style={avatarButtonStyle}
        aria-expanded={dropdownOpen}
        aria-haspopup="true"
      >
        {initial}
      </button>
      {dropdownOpen && (
        <div style={dropdownStyle}>
          <div style={dropdownEmailStyle}>{user.email}</div>
          <div style={dividerStyle} />
          <button type="button" onClick={() => { setDropdownOpen(false); logout(); }} style={logoutButtonStyle}>
            Logout
          </button>
        </div>
      )}
    </div>
  );
}

const loadingStyle: React.CSSProperties = { color: "var(--muted)", fontSize: "0.9rem" };
const authLinksStyle: React.CSSProperties = { display: "flex", gap: "var(--space-16)", alignItems: "center" };
const linkStyle: React.CSSProperties = { color: "var(--text)", textDecoration: "none", fontSize: "0.95rem" };
const avatarWrapStyle: React.CSSProperties = { position: "relative" };
const avatarButtonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  borderRadius: "50%",
  background: "var(--accent)",
  color: "var(--bg)",
  border: "none",
  fontSize: "1rem",
  fontWeight: 600,
  cursor: "pointer",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
};
const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  right: 0,
  marginTop: "var(--space-8)",
  minWidth: 200,
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius-btn)",
  boxShadow: "var(--shadow-card-hover)",
  padding: "var(--space-8) 0",
  zIndex: 50,
};
const dropdownEmailStyle: React.CSSProperties = {
  padding: "var(--space-8) var(--space-16)",
  fontSize: "0.9rem",
  color: "var(--muted)",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};
const dividerStyle: React.CSSProperties = {
  height: 1,
  background: "var(--border)",
  margin: "var(--space-8) 0",
};
const logoutButtonStyle: React.CSSProperties = {
  width: "100%",
  padding: "var(--space-8) var(--space-16)",
  background: "none",
  border: "none",
  color: "var(--text)",
  fontSize: "0.95rem",
  cursor: "pointer",
  textAlign: "left",
};
