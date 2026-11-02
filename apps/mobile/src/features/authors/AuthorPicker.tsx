import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import type { RecipeAuthor } from "@cooking/shared";
import { Button, TextField } from "../../components";
import { useApiClient } from "../../lib/api";
import { useT } from "../../lib/i18n";
import { colors, radii, spacing, typography } from "../../theme";
import { RecipeAuthorCredit } from "./RecipeAuthorCredit";

function normalizedName(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();
}

export function AuthorPicker({ value, onChange, disabled = false, allowCreate = true,
  initialExpanded = false, onBusyChange, onDismiss }: {
  value?: RecipeAuthor | null;
  onChange: (author: RecipeAuthor | null) => void;
  disabled?: boolean;
  allowCreate?: boolean;
  initialExpanded?: boolean;
  onBusyChange?: (busy: boolean) => void;
  onDismiss?: () => void;
}) {
  const api = useApiClient();
  const t = useT();
  const [expanded, setExpanded] = useState(initialExpanded);
  const [query, setQuery] = useState("");
  const [ownName, setOwnName] = useState(false);
  const [results, setResults] = useState<{ api: typeof api; query: string; authors: RecipeAuthor[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<"load" | "create" | null>(null);
  const [retry, setRetry] = useState(0);
  const currentApi = useRef(api);
  currentApi.current = api;
  const createRequest = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const busyCallback = useRef(onBusyChange);
  busyCallback.current = onBusyChange;

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; createRequest.current?.abort(); }; }, []);
  useEffect(() => {
    createRequest.current?.abort();
    createRequest.current = null;
    setCreating(false);
    setQuery("");
    setOwnName(false);
    busyCallback.current?.(false);
  }, [api]);

  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    let active = true;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const authors = await api.recipes.authors({ q: query.trim(), limit: 40, signal: controller.signal });
        if (active && currentApi.current === api) setResults({ api, query, authors });
      } catch {
        if (active && currentApi.current === api) setError("load");
      } finally {
        if (active && currentApi.current === api) setLoading(false);
      }
    })();
    return () => { active = false; controller.abort(); };
  }, [api, expanded, query, retry]);

  const lookupReady = results?.api === api && results.query === query;
  const authors = lookupReady ? results.authors : [];
  const name = query.trim().replace(/\s+/gu, " ");
  const equivalent = authors.some(author => [author.name, ...author.aliases].some(alias => normalizedName(alias) === normalizedName(name)));
  const pending = disabled || creating;

  function select(author: RecipeAuthor | null) {
    if (pending) return;
    onChange(author);
    setExpanded(false);
    setQuery("");
    setOwnName(false);
    setError(null);
  }

  async function create() {
    if (pending || loading || !lookupReady || error === "load" || !name || name.length > 80 || equivalent || createRequest.current) return;
    const controller = new AbortController();
    createRequest.current = controller;
    setCreating(true);
    setError(null);
    busyCallback.current?.(true);
    try {
      // The server resolves equivalent names/aliases atomically; a typed name
      // never becomes a credit until this explicit action succeeds.
      const author = await api.recipes.createAuthor({ name }, { signal: controller.signal });
      if (!mounted.current || currentApi.current !== api || controller.signal.aborted) return;
      onChange(author);
      setExpanded(false);
      setQuery("");
      setOwnName(false);
    } catch {
      if (mounted.current && currentApi.current === api && !controller.signal.aborted) setError("create");
    } finally {
      if (createRequest.current === controller) createRequest.current = null;
      if (mounted.current && currentApi.current === api) {
        setCreating(false);
        busyCallback.current?.(false);
      }
    }
  }

  return (
    <View style={styles.wrap}>
      {allowCreate ? <Text style={styles.label}>{t("recipe.author.label")}</Text> : null}
      {!expanded ? <View style={styles.summary}>
        <View style={styles.grow}><RecipeAuthorCredit author={value} /></View>
        <Button title={t(value ? "recipe.author.edit" : "recipe.author.add")} variant="ghost" disabled={disabled}
          onPress={() => { setQuery(""); setOwnName(false); setExpanded(true); }} />
      </View> : <View style={styles.picker}>
        {allowCreate ? <Text style={styles.hint}>{t("recipe.author.hint")}</Text> : null}
        {allowCreate && !ownName ? <Button title={t("recipe.author.useMyName")} variant="ghost" disabled={pending}
          onPress={() => { setQuery(""); setOwnName(true); }} /> : null}
        <TextField accessibilityLabel={t(ownName ? "recipe.author.name" : "recipe.author.search")}
          label={ownName ? t("recipe.author.name") : undefined} placeholder={t("recipe.author.search")}
          value={query} onChangeText={setQuery} editable={!pending} maxLength={80} autoCorrect={false} autoCapitalize="words" />
        {loading ? <ActivityIndicator accessibilityLabel={t("recipe.author.loading")} color={colors.primary} /> : null}
        {authors.map(author => <Pressable key={author.id} accessibilityRole="button"
          accessibilityLabel={t("recipe.author.credit", { name: author.name })}
          accessibilityState={{ selected: value?.id === author.id, disabled: pending }} disabled={pending}
          style={styles.option} onPress={() => select(author)}>
          <Text style={styles.name}>{author.name}</Text>
          {author.aliases.length ? <Text style={styles.hint}>{author.aliases.join(" · ")}</Text> : null}
        </Pressable>)}
        {!loading && !error && !authors.length ? <Text style={styles.hint}>{t("recipe.author.empty")}</Text> : null}
        {error ? <Text accessibilityRole="alert" style={styles.error}>{t(error === "load" ? "recipe.author.loadError" : "recipe.author.saveError")}</Text> : null}
        {error === "load" ? <Button title={t("library.retry")} variant="secondary" disabled={pending} onPress={() => setRetry(count => count + 1)} /> : null}
        {allowCreate && name && lookupReady && !equivalent && !loading && error !== "load" ?
          <Button title={t("recipe.author.createNamed", { name })} variant="secondary" loading={creating} disabled={pending}
            onPress={() => void create()} /> : null}
        <View style={styles.actions}>
          {value ? <Button title={t("recipe.author.clear")} disabled={pending} variant="ghost" onPress={() => select(null)} /> : null}
          <Button title={t("common.cancel")} disabled={pending} variant="ghost" onPress={() => { setExpanded(false); onDismiss?.(); }} />
        </View>
      </View>}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginVertical: spacing.sm },
  label: { ...typography.footnote, color: colors.onSurfaceVariant, fontWeight: "600" },
  summary: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  grow: { flex: 1 },
  picker: { padding: spacing.md, borderWidth: 1, borderColor: colors.divider, borderRadius: radii.md, gap: spacing.sm },
  option: { minHeight: 44, justifyContent: "center", paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.divider },
  name: { ...typography.body, color: colors.ink },
  hint: { ...typography.footnote, color: colors.mutedInk },
  error: { ...typography.footnote, color: colors.error },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
});
