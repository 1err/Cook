"use client";

import Link from "next/link";
import type { RecipeAuthor } from "@cooking/shared";
import { useT } from "../lib/i18n";
import { Icon } from "./ui/Icon";
import styles from "./RecipeAuthor.module.css";

/** Attribution is independent of the account that saved or shared the recipe. */
export function RecipeAuthorCredit({ author, onSelect, view, plain = false, detail = false }: {
  author?: RecipeAuthor | null;
  onSelect?: (author: RecipeAuthor) => void;
  view?: "mine" | "public";
  plain?: boolean;
  detail?: boolean;
}) {
  const t = useT();
  if (!author) return null;
  const label = t("recipe.author.by", { name: author.name });
  if (plain) return <span className={styles.plainCredit}>{label}</span>;
  const className = detail ? `${styles.credit} ${styles.detailCredit}` : styles.credit;
  const content = <><Icon name="account" size={detail ? 26 : 14} /><span>{label}</span></>;
  if (onSelect) return <button type="button" className={className} onClick={() => onSelect(author)}>{content}</button>;
  return <Link className={className} href={`/library?${view === "public" ? "view=public&" : ""}author_id=${encodeURIComponent(author.id)}&author_name=${encodeURIComponent(author.name)}`}>{content}</Link>;
}
