"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { RecipeAuthor } from "@cooking/shared";
import { apiFetch } from "../lib/api";
import { useT } from "../lib/i18n";
import { useAccountScope } from "../lib/useAccountScope";
import { useRecipeAuthors } from "../lib/useRecipeAuthors";
import { Button } from "./ui/Button";
import styles from "./RecipeAuthor.module.css";

export type AuthorPickerProps = {
  value?: RecipeAuthor | null;
  onChange: (author: RecipeAuthor | null) => void;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  initialOpen?: boolean;
};

function AuthorPickerPanel({ value, onChange, onClose, onBusyChange, disabled }: AuthorPickerProps & { onClose: () => void }) {
  const t = useT();
  const scope = useAccountScope();
  const [query, setQuery] = useState("");
  const lookup = useRecipeAuthors(query);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(-1);
  const listId = useId();
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => { controller.current?.abort(); onBusyChange?.(false); }, [onBusyChange]);
  useEffect(() => { setActive(-1); }, [query]);
  useEffect(() => {
    setQuery(""); setCreating(false); setName(""); setAliases(""); setError(null); setBusy(false);
    controller.current?.abort(); onBusyChange?.(false);
  }, [scope.accountId]);

  async function create() {
    const actor = scope.capture();
    if (!actor || !name.trim() || busy || disabled) return;
    if (name.trim().length > 80) { setError("recipe.author.nameLimit"); return; }
    const request = new AbortController();
    controller.current = request;
    const parsedAliases = [...new Set(aliases.split(/[,，\n]/).map(alias => alias.trim()).filter(Boolean))];
    if (parsedAliases.length > 8 || parsedAliases.some(alias => alias.length > 80)) { setError("recipe.author.aliasLimit"); return; }
    setBusy(true); onBusyChange?.(true); setError(null);
    try {
      const response = await apiFetch("/recipes/authors", { method: "POST", signal: request.signal,
        headers: { "X-Chef-World-Account-ID": actor.id }, body: JSON.stringify({ name: name.trim(),
          aliases: parsedAliases,
        }),
      });
      if (!response.ok) throw new Error("Could not create author");
      const author: RecipeAuthor = await response.json();
      if (!request.signal.aborted && scope.active(actor)) onChange(author);
    } catch {
      if (!request.signal.aborted && scope.active(actor)) setError("recipe.author.createError");
    } finally {
      if (!request.signal.aborted && scope.active(actor)) { setBusy(false); onBusyChange?.(false); }
    }
  }

  return <div className={styles.pickerPanel} aria-busy={busy || undefined}>
    <p className={styles.help}>{t("recipe.author.help")}</p>
    <label className={styles.field}>
      <span>{t("recipe.author.search")}</span>
      <input autoFocus type="text" role="combobox" aria-autocomplete="list" aria-expanded={!creating}
        maxLength={200} aria-controls={listId} aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        value={query} disabled={busy || disabled} onChange={event => { setQuery(event.target.value); setCreating(false); }}
        onKeyDown={event => {
          if (event.key === "Escape" && !busy) { event.preventDefault(); onClose(); }
          if (!creating && lookup.authors.length && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault(); setActive(current => event.key === "ArrowDown" ? (current + 1) % lookup.authors.length : (current <= 0 ? lookup.authors.length - 1 : current - 1));
          }
          if (!creating && event.key === "Enter" && active >= 0 && lookup.authors[active]) {
            event.preventDefault(); onChange(lookup.authors[active]);
          }
        }} />
    </label>
    {!creating ? <>
      {lookup.loading ? <p role="status" className={styles.help}>{t("common.loading")}</p> : null}
      {lookup.error ? <div role="alert"><p>{t("recipe.author.lookupError")}</p><Button size="sm" variant="ghost" onClick={lookup.retry}>{t("library.retry")}</Button></div> : null}
      <ul id={listId} role="listbox" aria-label={t("recipe.author.filter")} className={styles.results}>
        {lookup.authors.map((author, index) => <li key={author.id} role="presentation"><button type="button" role="option"
          id={`${listId}-${index}`} aria-selected={active === index || value?.id === author.id} disabled={busy || disabled}
          onClick={() => onChange(author)}><strong>{author.name}</strong>{author.aliases.length ? <small>{author.aliases.join(" · ")}</small> : null}</button></li>)}
      </ul>
      <div className={styles.actions}>
        <Button size="sm" variant="secondary" disabled={busy || disabled} onClick={() => { setName(query.trim()); setCreating(true); }}>{t("recipe.author.create")}</Button>
        <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={() => { setName(""); setCreating(true); }}>{t("recipe.author.useMyName")}</Button>
      </div>
    </> : <div className={styles.createForm}>
      <label className={styles.field}><span>{t("recipe.author.name")}</span><input autoFocus maxLength={80} value={name} disabled={busy || disabled}
        aria-invalid={name.trim().length > 80 || undefined} aria-describedby={name.trim().length > 80 ? `${listId}-name-error` : undefined}
        onChange={event => setName(event.target.value)} /></label>
      {name.trim().length > 80 ? <small id={`${listId}-name-error`} role="alert">{t("recipe.author.nameLimit")}</small> : null}
      <label className={styles.field}><span>{t("recipe.author.aliases")}</span><input maxLength={648} value={aliases} disabled={busy || disabled} onChange={event => setAliases(event.target.value)} /></label>
      {error ? <p role="alert">{t(error)}</p> : null}
      <div className={styles.actions}><Button size="sm" disabled={!name.trim() || name.trim().length > 80 || disabled} loading={busy} onClick={() => void create()}>{t("common.save")}</Button>
        <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={() => { setCreating(false); setError(null); }}>{t("common.back")}</Button></div>
    </div>}
    <div className={styles.actions}>
      {value ? <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={() => onChange(null)}>{t("recipe.author.clear")}</Button> : null}
      <Button size="sm" variant="ghost" disabled={busy || disabled} onClick={onClose}>{t("common.cancel")}</Button>
    </div>
  </div>;
}

export function AuthorPicker(props: AuthorPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(props.initialOpen ?? false);
  const trigger = useRef<HTMLButtonElement>(null);
  function close() { setOpen(false); requestAnimationFrame(() => trigger.current?.focus()); }
  return <div className={styles.picker}>
    <span className={styles.label}>{t("recipe.author.label")}</span>
    <button ref={trigger} type="button" className={styles.pickerTrigger} disabled={props.disabled} aria-expanded={open}
      onClick={() => setOpen(current => !current)}>{props.value ? props.value.name : t("recipe.author.add")}</button>
    {open ? <AuthorPickerPanel {...props} onClose={close} onChange={author => { props.onChange(author); close(); }} /> : null}
  </div>;
}
