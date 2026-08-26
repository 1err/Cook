"use client";

import { Button } from "../components/ui/Button";
import { useT } from "../lib/i18n";
import styles from "./CookPage.module.css";
import { useCookingSession } from "./useCookingSession";
import { CookSetup } from "./CookSetup";
import { CookWorkspace } from "./CookWorkspace";

export function CookScreen() {
  const t = useT();
  const controller = useCookingSession();

  if (controller.status === "loading") {
    return (
      <div className={styles.centerState}>
        <p role="status">{t("common.loading")}</p>
      </div>
    );
  }

  if (controller.status === "error") {
    return (
      <section className={styles.centerState}>
        <p className={styles.eyebrow}>{t("nav.cook")}</p>
        <h1>{t("cook.error.title")}</h1>
        <p role="alert">{controller.error}</p>
        <Button variant="secondary" onClick={() => void controller.refresh()}>
          {t("common.refresh")}
        </Button>
      </section>
    );
  }

  if (!controller.session) {
    return <CookSetup onSessionCreated={controller.acceptSession} />;
  }

  return <CookWorkspace controller={controller} />;
}
