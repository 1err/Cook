"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ApiError, type MediaReview } from "@cooking/api-client";
import { PageHeader, PageShell } from "../components/PageShell";
import { useAccountScope, type AccountActor } from "../components/safety/useAccountScope";
import { webApiClient } from "../lib/api";
import { useT } from "../lib/i18n";
import styles from "./Moderation.module.css";

function PhotoReview({ review, onReviewed, onRefresh }: {
  review: MediaReview; onReviewed: (actor: AccountActor) => void; onRefresh: () => void;
}) {
  const t = useT();
  const scope = useAccountScope();
  const id = useId();
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const photos = [
    ...(review.recipe.thumbnail_url ? [{ url: review.recipe.thumbnail_url, label: "Recipe cover" }] : []),
    ...(review.recipe.steps ?? []).flatMap((step, index) => step.image_url ? [{ url: step.image_url, label: `Step ${index + 1}` }] : []),
  ];
  async function decide(decision: "approve" | "reject") {
    const actor = scope.capture();
    if (!actor || busyRef.current) return;
    if (!window.confirm(`${t("safety.photoReviewConfirm")}\n\n${t(decision === "approve" ? "safety.approvePhotos" : "safety.rejectPhotos")}\n${review.recipe.title}`)) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await webApiClient.mediaReview.review(review.id, decision, review.media_digest, notes.trim() || undefined, actor.id);
      onReviewed(actor);
    } catch (caught) {
      if (scope.active(actor)) setError(t(caught instanceof ApiError && caught.status === 409 ? "safety.photosChanged" : "safety.failed"));
    } finally {
      busyRef.current = false;
      if (scope.active(actor)) setBusy(false);
    }
  }
  return <article className={styles.report}>
    <h2>{review.recipe.title}</h2>
    <p className={styles.meta}>{new Date(review.created_at).toLocaleString()} · {t(`safety.${review.status}`)}</p>
    <div className={styles.photos}>
      {photos.map((photo, index) => <figure key={`${index}:${photo.url}`}>
        <img src={photo.url} alt={photo.label} />
        <figcaption>{photo.label}<br />{review.eligible_media_urls?.includes(photo.url) ? "Eligible Chef World upload" : "Source image is hidden from shared views. Upload a replacement for sharing."}</figcaption>
      </figure>)}
    </div>
    <p className={styles.meta}>Recipe {review.recipe_id} · Photo set {review.media_digest.slice(0, 12)}</p>
    {review.status === "pending" ? <div className={styles.form}>
      <label htmlFor={`${id}-notes`}>{t("safety.moderationNotes")}</label>
      <textarea id={`${id}-notes`} value={notes} onChange={(event) => setNotes(event.target.value)} maxLength={2000} rows={2} disabled={busy} />
      {error ? <p role="alert" className={styles.error}>{error} <button type="button" className={styles.button} onClick={onRefresh}>{t("safety.refresh")}</button></p> : null}
      <div className={styles.toolbar}>
        <button type="button" className="btn-primary" disabled={busy || !review.eligible_media_urls?.length} onClick={() => void decide("approve")}>{t("safety.approvePhotos")}</button>
        <button type="button" className={styles.button} disabled={busy} onClick={() => void decide("reject")}>{t("safety.rejectPhotos")}</button>
      </div>
    </div> : review.review_notes ? <p>{review.review_notes}</p> : null}
  </article>;
}

export function MediaReviewQueue() {
  const t = useT();
  const scope = useAccountScope();
  const [status, setStatus] = useState<"pending" | "approved" | "rejected">("pending");
  const [offset, setOffset] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [reviews, setReviews] = useState<MediaReview[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    const actor = scope.capture();
    if (!actor) return;
    setLoading(true); setFailed(false); setReviews([]);
    webApiClient.mediaReview.list({ status, limit: 50, offset, expectedAccountId: actor.id }).then((result) => {
      if (active && scope.active(actor)) { setReviews(result.reviews); setTotal(result.total); }
    }).catch(() => {
      if (active && scope.active(actor)) { setReviews([]); setTotal(0); setFailed(true); }
    }).finally(() => { if (active && scope.active(actor)) setLoading(false); });
    return () => { active = false; };
  }, [status, offset, refresh, scope.accountId]);
  function reviewed(actor: AccountActor) { if (scope.active(actor)) setRefresh((value) => value + 1); }
  return <PageShell>
    <PageHeader title={t("safety.mediaReviews")} actions={<button type="button" className={styles.button} disabled={loading} onClick={() => setRefresh((value) => value + 1)}>{t("safety.refresh")}</button>} />
    <p>Review every cover and step photo. Only eligible Chef World uploads can be approved for sharing. External source images stay hidden from shared views, including in a mixed set that contains approved uploads; the owner must upload a replacement they have permission to share. Approval applies to this exact photo set, and later changes require another review.</p>
    <div className={styles.toolbar}>{(["pending", "approved", "rejected"] as const).map((value) => <button type="button" className={styles.button} key={value} aria-pressed={status === value} onClick={() => { setStatus(value); setOffset(0); }}>{t(`safety.${value}`)}</button>)}</div>
    {failed ? <p role="alert" className={styles.error}>{t("safety.loadFailed")}</p> : null}
    {loading ? <p role="status">{t("common.loading")}</p> : reviews.length === 0 && !failed ? <p>No {status} photo sets.</p> : null}
    {reviews.map((review) => <PhotoReview key={review.id} review={review} onReviewed={reviewed} onRefresh={() => setRefresh((value) => value + 1)} />)}
    {total > 50 || offset > 0 ? <div className={styles.toolbar}>
      <button type="button" className={styles.button} disabled={loading || offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 50))}>Previous</button>
      <span>{offset + 1}–{Math.min(offset + 50, total)} / {total}</span>
      <button type="button" className={styles.button} disabled={loading || offset + 50 >= total} onClick={() => setOffset((value) => value + 50)}>Next</button>
    </div> : null}
  </PageShell>;
}
