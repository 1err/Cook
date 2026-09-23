"use client";

import { Button } from "../components/ui/Button";
import { Icon } from "../components/ui/Icon";
import { useT } from "../lib/i18n";
import styles from "./CookPage.module.css";
import { useCookingSession } from "./useCookingSession";
import { CookSetup } from "./CookSetup";
import { CookWorkspace } from "./CookWorkspace";
import { useAuth } from "../lib/auth";

export function CookScreen() {
  const t = useT();
  const { user } = useAuth();
  const controller = useCookingSession(user?.id ?? null);

  if (controller.status === "loading") {
    return (
      <div className={styles.centerState}>
        <span className={styles.loadingMark} aria-hidden="true" />
        <p role="status">{t("common.loading")}</p>
      </div>
    );
  }

  if (controller.status === "error") {
    return (
      <section className={styles.centerState}>
        <div className={styles.errorPanel}>
          <Icon name="chef" size={36} className={styles.errorIcon} />
          <p className={styles.eyebrow}>{t("nav.cook")}</p>
          <h1>{t("cook.error.title")}</h1>
          <p role="alert">{controller.error}</p>
          <Button variant="secondary" onClick={() => void controller.refresh()}>
            {t("common.refresh")}
          </Button>
        </div>
      </section>
    );
  }

  if (!controller.session) {
    return <CookSetup onSessionCreated={controller.acceptSession} />;
  }

  return <CookWorkspace controller={controller} />;
}
