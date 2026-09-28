"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PublicShell } from "./PublicShell";
import { HOME_COPY, HOME_FEATURES, type HomeLanguage } from "./homeContent";
import styles from "./HomePage.module.css";

function Arrow({ back = false }: { back?: boolean }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d={back ? "M20 12H5m6-6-6 6 6 6" : "M4 12h15m-6-6 6 6-6 6"} /></svg>;
}
function PlayIcon({ filled = false }: { filled?: boolean }) {
  return <svg viewBox="0 0 24 24" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m7 4 13 8-13 8Z" /></svg>;
}

export function HomePage() {
  // Public-page copy never overwrites the user's separately stored app language.
  const [language, setLanguage] = useState<HomeLanguage>("en");
  const [selected, setSelected] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  const [videoStarted, setVideoStarted] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const tabs = useRef<Array<HTMLButtonElement | null>>([]);
  const dialog = useRef<HTMLDialogElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const copy = HOME_COPY[language];
  const feature = HOME_FEATURES[selected];
  const details = feature[language];
  const locale = language === "zh" ? "zh-CN" : "en";

  useEffect(() => { setHydrated(true); }, []);

  function selectFeature(index: number, focus = false) {
    const next = (index + HOME_FEATURES.length) % HOME_FEATURES.length;
    setSelected(next);
    if (focus) {
      tabs.current[next]?.focus();
      tabs.current[next]?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    }
  }
  function navigateTabs(event: KeyboardEvent<HTMLDivElement>) {
    let next: number;
    switch (event.key) {
      case "ArrowRight": next = selected + 1; break;
      case "ArrowLeft": next = selected - 1; break;
      case "Home": next = 0; break;
      case "End": next = HOME_FEATURES.length - 1; break;
      default: return;
    }
    event.preventDefault();
    selectFeature(next, true);
  }
  async function playPreview() {
    setVideoError(false);
    setVideoStarted(true);
    try { await video.current?.play(); }
    catch { setVideoError(true); setVideoStarted(false); }
  }
  function playbackFailed() { setVideoError(true); setVideoStarted(false); }

  return <PublicShell language={language} onLanguageChange={() => setLanguage(current => current === "en" ? "zh" : "en")}>
    <main id="main-content" className={styles.homepage} lang={locale}>
      <section className={`${styles.wrap} ${styles.hero}`} aria-labelledby="home-title">
        <div>
          <h1 id="home-title">{language === "en" ? <>A little closer<br />to <em>home.</em></> : <>让每一餐，<br />更有<em>家的味道。</em></>}</h1>
          <p className={styles["hero-intro"]}>{copy.heroIntro}</p>
          <div className={styles["hero-actions"]}>
            <Link className={styles.button} href="/library"><span>{copy.openApp}</span><Arrow /></Link>
            <a className={styles["text-button"]} href="#preview"><PlayIcon /><span>{copy.watch}</span></a>
          </div>
        </div>
        <figure className={styles["hero-visual"]}>
          <img className={styles["hero-library"]} src="/brand/features/02-library.webp" width={1280} height={720} alt={language === "en" ? "Actual Chef World recipe library with Chinese home-cooking dishes" : "Chef World 实际菜谱库，包含多道中式家常菜"} fetchPriority="high" />
          <img className={styles["hero-menu"]} src="/brand/features/menu-generated.webp" width={1024} height={1536} alt={language === "en" ? "Actual AI-generated illustrated menu using dishes from this recipe library" : "用这个菜谱库里的菜实际生成的 AI 插画菜单"} />
          <figcaption><span>{copy.heroCaption}</span><span className={styles["hero-proof"]}>{copy.heroProof}</span></figcaption>
        </figure>
      </section>
      <section className={`${styles.wrap} ${styles.showcase} ${styles["section-rule"]}`} aria-labelledby="features-title">
        <div className={styles["section-heading"]}>
          <h2 id="features-title">{language === "en" ? <>Less juggling.<br />More cooking.</> : <>少一点手忙脚乱，<br />多一点做饭的快乐。</>}</h2>
          <p>{copy.featuresIntro}</p>
        </div>
        <div className={styles.tabs} role="tablist" aria-label={language === "en" ? "Explore Chef World features" : "探索 Chef World 功能"} onKeyDown={navigateTabs}>
          {HOME_FEATURES.map((item, index) => <button key={item.id} type="button" ref={element => { tabs.current[index] = element; }} className={styles.tab} role="tab" id={`feature-tab-${item.id}`} aria-controls="feature-panel" aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} onClick={() => selectFeature(index)}>{item[language].label}</button>)}
        </div>
        <div id="feature-panel" className={styles["feature-panel"]} role="tabpanel" aria-labelledby={`feature-tab-${feature.id}`} tabIndex={0}>
          <figure className={styles["screen-figure"]}>
            <button type="button" className={styles["screen-button"]} onClick={() => dialog.current?.showModal()} aria-label={language === "en" ? `Enlarge ${details.label} screenshot` : `放大${details.label}截图`}>
              <img src={feature.image} width={1280} height={720} alt={details.caption} loading="lazy" />
            </button>
            <figcaption><span>{details.caption}</span><span>{copy.enlarge}</span></figcaption>
          </figure>
          <div className={styles["feature-copy"]}>
            <p className={styles["feature-number"]}>0{selected + 1} / {details.label}</p>
            <h3 className={styles.benefit}>{details.title}</h3>
            <p className={styles["feature-body"]}>{details.body}</p>
            <Link className={styles["text-button"]} href={feature.path}><span>{details.cta}</span><Arrow /></Link>
            {details.note ? <p className={styles["feature-footnote"]}>{details.note}</p> : null}
          </div>
        </div>
        <div className={styles["feature-paging"]}><span className={styles["paging-text"]}>{copy.screensNote}</span><div className={styles["paging-controls"]}>
          <button type="button" className={styles["icon-button"]} onClick={() => selectFeature(selected - 1)} aria-label={language === "en" ? "Previous feature" : "上一个功能"}><Arrow back /></button>
          <button type="button" className={styles["icon-button"]} onClick={() => selectFeature(selected + 1)} aria-label={language === "en" ? "Next feature" : "下一个功能"}><Arrow /></button>
        </div></div>
      </section>
      <section className={styles.preview} id="preview" aria-labelledby="preview-title">
        <div className={`${styles.wrap} ${styles["video-grid"]}`}>
          <div className={styles["video-copy"]}>
            <p className={styles.eyebrow}>{copy.previewEyebrow}</p>
            <h2 id="preview-title">{language === "en" ? <>From “that looks good”<br />to “dinner’s ready.”</> : <>从“看起来好好吃”，<br />到“可以开饭啦”。</>}</h2>
            <p>{copy.previewIntro}</p>
          </div>
          <div>
            <div className={styles["video-wrap"]}>
              <video ref={video} playsInline preload="none" controls poster="/brand/features/02-library.webp" aria-label={language === "en" ? "30-second Chef World feature preview" : "30 秒 Chef World 功能预览"} onPlay={() => setVideoStarted(true)} onEnded={() => setVideoStarted(false)} onError={playbackFailed}>
                <source src="/brand/features/homepage-preview.mp4" type="video/mp4" onError={playbackFailed} />
              </video>
              {hydrated && !videoStarted ? <button type="button" className={styles["video-start"]} onClick={() => void playPreview()}><span className={styles["play-disc"]}><PlayIcon filled /></span><span>{copy.play}</span></button> : null}
            </div>
            <p className={styles["video-note"]}>{copy.videoNote}</p>
            {videoError ? <p className={styles["video-error"]} role="alert">{copy.videoError}</p> : null}
            <details className={styles.transcript}><summary>{language === "en" ? "Read the preview description" : "阅读功能预览文字版"}</summary><ol>{HOME_FEATURES.map(item => <li key={item.id}><strong>{item[language].label}: </strong>{item[language].body}</li>)}</ol></details>
          </div>
        </div>
      </section>
      <section className={`${styles.wrap} ${styles.partnership}`} aria-labelledby="partnership-title"><div><h2 id="partnership-title">{copy.partnershipTitle}</h2><p>{copy.partnershipBody}</p></div><Link href="/contact">{copy.contact}</Link></section>
      <dialog ref={dialog} className={styles.dialog} aria-labelledby="feature-lightbox-title" onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) dialog.current?.close(); } }}>
        <div className={styles["lightbox-top"]}><span id="feature-lightbox-title">{details.caption}</span><button type="button" onClick={() => dialog.current?.close()} aria-label={language === "en" ? "Close screenshot" : "关闭截图"}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button></div>
        <img src={feature.image} alt={details.caption} loading="lazy" />
      </dialog>
    </main>
  </PublicShell>;
}
