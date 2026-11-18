"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import type { RecipeAuthor } from "@cooking/shared";
import { apiFetch } from "../lib/api";
import { useT } from "../lib/i18n";
import { useAccountScope } from "../lib/useAccountScope";
import { AuthorSearch } from "./AuthorSearch";
import { Icon } from "./ui/Icon";
import { Button } from "./ui/Button";
import styles from "./RecipeAuthor.module.css";

export type AuthorPickerProps = {
  value?: RecipeAuthor | null;
  onChange: (author: RecipeAuthor | null) => void | Promise<void>;
  disabled?: boolean;
  onBusyChange?: (busy: boolean) => void;
  inline?: boolean;
};

type DialogProps = AuthorPickerProps & { onClose: () => void };

function AuthorDialog(props: DialogProps) {
  const scope = useAccountScope();
  return <AuthorDialogContent key={scope.accountId} {...props} scope={scope} />;
}

function AuthorDialogContent({ value, onChange, disabled, onBusyChange, inline, onClose, scope }: DialogProps & {
  scope: ReturnType<typeof useAccountScope>;
}) {
  const t = useT();
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);
  const [selected, setSelected] = useState(value ?? null);
  const [mode, setMode] = useState<"search" | "new" | "self">("search");
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [aliases, setAliases] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const nameInput = useRef<HTMLInputElement>(null);
  const changed = (selected?.id ?? null) !== (value?.id ?? null);

  useLayoutEffect(() => {
    const element = dialog.current!;
    if (typeof element.showModal === "function") element.showModal();
    else element.setAttribute("open", "");
    const viewport = window.visualViewport;
    function fitKeyboard() {
      if (!viewport) return;
      element.style.setProperty("--author-visible-height", viewport.height + "px");
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      element.style.setProperty("--author-bottom", inset + "px");
    }
    fitKeyboard();
    viewport?.addEventListener("resize", fitKeyboard);
    viewport?.addEventListener("scroll", fitKeyboard);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (window.matchMedia?.("(pointer: coarse)").matches) heading.current?.focus({ preventScroll: true });
    else element.querySelector<HTMLInputElement>('[role="combobox"]')?.focus({ preventScroll: true });
    return () => {
      viewport?.removeEventListener("resize", fitKeyboard);
      viewport?.removeEventListener("scroll", fitKeyboard);
      document.body.style.overflow = oldOverflow;
      if (typeof element.close === "function") element.close();
    };
  }, []);

  useEffect(() => () => { request.current?.abort(); onBusyChange?.(false); }, [onBusyChange]);
  useEffect(() => { if (mode !== "search") nameInput.current?.focus({ preventScroll: true }); }, [mode]);

  function startCreate(nextMode: "self" | "new") {
    setError("");
    setName(nextMode === "new" ? query.trim() : "");
    setAliases("");
    setMode(nextMode);
  }

  async function apply(author: RecipeAuthor | null, create = false) {
    const actor = scope.capture();
    if (!actor || request.current || disabled) return;
    const trimmedName = name.trim();
    const aliasList = [...new Set(aliases.split(/[,，\n]/).map(alias => alias.trim()).filter(Boolean))];
    if (create && (!trimmedName || trimmedName.length > 80)) { setError("recipe.author.nameLimit"); return; }
    if (create && (aliasList.length > 8 || aliasList.some(alias => alias.length > 80))) {
      setError("recipe.author.aliasLimit"); return;
    }
    const controller = new AbortController();
    request.current = controller;
    setBusy(true);
    onBusyChange?.(true);
    setError("");
    let errorKey = create ? "recipe.author.createError" : "recipe.author.saveError";
    try {
      if (create) {
        const response = await apiFetch("/recipes/authors", {
          method: "POST", signal: controller.signal,
          headers: { "X-Chef-World-Account-ID": actor.id },
          body: JSON.stringify({ name: trimmedName, aliases: aliasList }),
        });
        if (!response.ok) {
          if (response.status === 409) errorKey = "recipe.author.identityConflict";
          throw new Error("Author creation failed");
        }
        author = await response.json() as RecipeAuthor;
        if (controller.signal.aborted || !scope.active(actor)) return;
        errorKey = "recipe.author.saveError";
      }
      await onChange(author);
      if (scope.active(actor) && !controller.signal.aborted) onClose();
    } catch {
      if (scope.active(actor) && !controller.signal.aborted) {
        if (create && author && errorKey === "recipe.author.saveError") {
          // Retry the credit with the canonical author already returned by the directory.
          setSelected(author);
          setQuery(author.name);
          setMode("search");
        }
        setError(errorKey);
      }
    } finally {
      if (!controller.signal.aborted && scope.active(actor)) {
        request.current = null;
        setBusy(false);
        onBusyChange?.(false);
      }
    }
  }

  function select(author: RecipeAuthor | null) {
    setError("");
    if (inline) setSelected(author);
    else void apply(author);
  }

  const creating = mode !== "search";
  const title = mode === "self" ? "recipe.author.creditSelf" : mode === "new" ? "recipe.author.create" : value ? "recipe.author.edit" : "recipe.author.add";
  return <dialog ref={dialog} className={styles.dialog} aria-labelledby={titleId} aria-modal="true" aria-busy={busy || undefined}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={event => {
      if (event.key === "Escape" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault(); event.stopPropagation(); if (!busy) onClose();
      }
      if (creating && event.key === "Enter" && event.target instanceof HTMLInputElement
          && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
        event.preventDefault();
        if (name.trim() && name.trim().length <= 80) void apply(selected, true);
      }
    }}
    onClick={event => {
      if (busy || event.target !== event.currentTarget) return;
      const rect = event.currentTarget.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
    }}>
    <div className={styles.dialogHeader}>
      {creating && <button type="button" className={styles.iconButton} disabled={busy} aria-label={t("common.back")}
        onClick={() => { setMode("search"); setError(""); }}><Icon name="arrowLeft" size={18} /></button>}
      <h2 id={titleId} tabIndex={-1} ref={heading}>{t(title)}</h2>
      <button type="button" className={styles.iconButton} disabled={busy} aria-label={t("common.cancel")} title={t("common.cancel")} onClick={onClose}>
        <Icon name="close" size={18} />
      </button>
    </div>
    <div className={styles.dialogBody}>
      {creating ? <div className={styles.createFields}>
        <label className={styles.field}>
          <span>{t("recipe.author.name")}</span>
          <input ref={nameInput} maxLength={80} value={name} disabled={busy} autoComplete="off"
            aria-invalid={name.trim().length > 80 || undefined}
            onChange={event => setName(event.target.value)} />
        </label>
        {name.trim().length > 80 && <p role="alert" className={styles.error}>{t("recipe.author.nameLimit")}</p>}
        <details className={styles.aliases}>
          <summary>{t("recipe.author.otherNames")}</summary>
          <label className={styles.field}><span>{t("recipe.author.aliases")}</span>
            <input maxLength={648} value={aliases} disabled={busy} onChange={event => setAliases(event.target.value)} />
          </label>
        </details>
      </div> : <>
        <AuthorSearch selected={selected} query={query} onQueryChange={setQuery} onSelect={select} disabled={busy || disabled} />
        <div className={styles.createActions}>
          <button type="button" disabled={busy || disabled} onClick={() => startCreate("new")}>
            <Icon name="add" size={16} />{t("recipe.author.create")}
          </button>
          <button type="button" disabled={busy || disabled} onClick={() => startCreate("self")}>
            <Icon name="account" size={16} />{t("recipe.author.creditSelf")}
          </button>
        </div>
      </>}
      {error && <p className={styles.error} role="alert">{t(error)}</p>}
    </div>
    {(inline || creating || selected) && <div className={styles.dialogFooter}>
      {!creating && selected && <div className={styles.selectedCredit}>
        <Icon name="account" size={15} /><span title={selected.name}>{selected.name}</span>
        <button type="button" disabled={busy || disabled} aria-label={t("recipe.author.clear")} title={t("recipe.author.clear")}
          onClick={() => select(null)}><Icon name="close" size={14} /></button>
      </div>}
      {inline && !creating && !selected && changed && <span className={styles.removalNote}>{t("recipe.author.removalPending")}</span>}
      {(creating || inline) && <Button className={styles.apply} size="sm" loading={busy}
        disabled={disabled || (creating ? !name.trim() || name.trim().length > 80 : !changed)}
        onClick={() => void apply(selected, creating)}>{t(inline ? "recipe.author.saveCredit" : "common.save")}</Button>}
    </div>}
  </dialog>;
}

export function AuthorPicker(props: AuthorPickerProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  function close() {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus({ preventScroll: true }));
  }
  return <div className={props.inline ? styles.inlinePicker : styles.picker}>
    {!props.inline && <span className={styles.label}>{t("recipe.author.label")}</span>}
    <button ref={trigger} type="button" className={props.inline ? styles.inlineTrigger : styles.pickerTrigger}
      disabled={props.disabled} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <Icon name={props.inline ? (props.value ? "edit" : "add") : "account"} size={props.inline ? 14 : 17} />
      {props.inline ? t(props.value ? "recipe.author.edit" : "recipe.author.add") : props.value?.name ?? t("recipe.author.add")}
      {!props.inline && <Icon name="chevronDown" size={15} />}
    </button>
    {open && <AuthorDialog {...props} onClose={close} />}
  </div>;
}
