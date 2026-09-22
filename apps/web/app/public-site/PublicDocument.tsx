import { Fragment } from "react";
import { CONTACT_EMAIL, PUBLIC_DOCUMENTS, type PublicDocumentKind } from "./documents";
import { PublicShell } from "./PublicShell";
import styles from "./PublicSite.module.css";

function LinkedText({ text }: { text: string }) {
  return <>{text.split(CONTACT_EMAIL).map((part, index) => <Fragment key={index}>{index > 0 && <a href={`mailto:${CONTACT_EMAIL}`}>{CONTACT_EMAIL}</a>}{part}</Fragment>)}</>;
}

export function PublicDocument({ kind }: { kind: PublicDocumentKind }) {
  const content = PUBLIC_DOCUMENTS[kind];
  return (
    <PublicShell>
      <main id="main-content" className={styles.document}>
        <header className={styles.documentHeader}>
          <p className={styles.eyebrow}>{content.eyebrow}</p>
          <h1>{content.title}</h1>
          <p className={styles.documentIntro}><LinkedText text={content.intro} /></p>
          {content.updated && <p className={styles.updated}>{content.updated}</p>}
        </header>
        <div className={styles.documentBody}>
          {content.sections.map((section, index) => (
            <section id={kind === "contact" && index === 2 ? "partnerships" : `section-${index + 1}`} key={section.heading}>
              <h2>{section.heading}</h2>
              {section.paragraphs.map((paragraph) => <p key={paragraph}><LinkedText text={paragraph} /></p>)}
              {section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}><LinkedText text={bullet} /></li>)}</ul>}
            </section>
          ))}
        </div>
      </main>
    </PublicShell>
  );
}
