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
    return <span style={{ color: "var(--on-surface-variant)", fontSize: "0.9rem" }}>…</span>;
  }

  if (!user) {
    return (
      <div style={{ display: "flex", gap: "var(--space-16)", alignItems: "center" }}>
        <Link href="/login" className="font-headline" style={{ color: "var(--on-surface-variant)", fontSize: "0.9rem", fontWeight: 700 }}>
          Sign in
        </Link>
        <Link
          href="/register"
          className="font-headline"
          style={{
            fontSize: "0.9rem",
            fontWeight: 700,
            padding: "0.45rem 1rem",
            borderRadius: "var(--radius-md)",
            background: "var(--surface-container-low)",
            color: "var(--primary)",
            boxShadow: "0 0 0 1px color-mix(in srgb, var(--outline-variant) 20%, transparent)",
          }}
        >
          Register
        </Link>
      </div>
    );
  }

  const initial = user.email.charAt(0).toUpperCase();

  return (
    <div style={{ position: "relative" }} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setDropdownOpen((o) => !o)}
        aria-expanded={dropdownOpen}
        aria-haspopup="true"
        aria-label={`Account menu for ${user.email}`}
        title={user.email}
        className="font-headline"
        style={{
          width: 40,
          height: 40,
          borderRadius: "50%",
          background: "var(--primary-gradient)",
          color: "#fff",
          border: "none",
          fontSize: "1rem",
          fontWeight: 700,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          boxShadow: "var(--kitchen-glow)",
        }}
      >
        {initial}
      </button>
      {dropdownOpen && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            right: 0,
            marginTop: "var(--space-8)",
            minWidth: 220,
            background: "var(--surface-container-lowest)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--kitchen-glow-lg)",
            padding: "var(--space-8)",
            zIndex: 50,
            boxSizing: "border-box",
          }}
        >
          <p
            className="font-headline"
            style={{
              margin: "0 0 var(--space-8)",
              padding: "0 var(--space-12)",
              fontSize: "0.72rem",
              fontWeight: 800,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--on-surface-variant)",
            }}
          >
            Account
          </p>
          <div
            style={{
              padding: "var(--space-12) var(--space-12)",
              fontSize: "0.85rem",
              color: "var(--on-surface-variant)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              background: "var(--surface-container-low)",
              borderRadius: "var(--radius-md)",
              marginBottom: "var(--space-8)",
            }}
          >
            {user.email}
          </div>
          <button
            type="button"
            onClick={() => {
              setDropdownOpen(false);
              logout();
            }}
            className="font-headline"
            style={{
              width: "100%",
              padding: "var(--space-12) var(--space-16)",
              background: "transparent",
              border: "none",
              color: "var(--on-surface)",
              fontSize: "0.95rem",
              fontWeight: 700,
              cursor: "pointer",
              textAlign: "left",
              borderRadius: "var(--radius-md)",
            }}
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
