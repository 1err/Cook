"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/ui/Icon";
import { useT } from "../../lib/i18n";
import styles from "./RecipeEdit.module.css";

const sections = [
  { id: "recipe-basics", label: "recipe.basicDetails" },
  { id: "recipe-ingredients", label: "common.ingredients" },
  { id: "recipe-steps", label: "recipe.steps" },
  { id: "recipe-more", label: "recipe.editor.tipsAndTags" },
  { id: "recipe-sharing", label: "recipe.sharingAndSource" },
] as const;

type SectionId = (typeof sections)[number]["id"];

export function useEditorSection() {
  const [active, setActive] = useState<SectionId>("recipe-basics");
  useEffect(() => {
    function readHash() {
      const section = sections.find(item => "#" + item.id === window.location.hash);
      setActive(section?.id ?? "recipe-basics");
    }
    readHash();
    window.addEventListener("hashchange", readHash);
    window.addEventListener("popstate", readHash);
    return () => {
      window.removeEventListener("hashchange", readHash);
      window.removeEventListener("popstate", readHash);
    };
  }, []);

  function select(id: SectionId) {
    if (active !== id) {
      window.history.pushState(window.history.state, "", "#" + id);
      setActive(id);
    }
    if (window.scrollY > 0) window.scrollTo({ top: 0, behavior: "instant" });
  }

  function panel(id: SectionId) {
    return { id, role: "tabpanel", "aria-labelledby": "tab-" + id, hidden: active !== id, tabIndex: 0 };
  }

  return { active, select, panel };
}

export function EditorSections({ active, onSelect, ingredientCount, stepCount }: {
  active: SectionId;
  onSelect: (id: SectionId) => void;
  ingredientCount: number;
  stepCount: number;
}) {
  const t = useT();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const counts: Partial<Record<SectionId, number>> = { "recipe-ingredients": ingredientCount, "recipe-steps": stepCount };
  return <>
    <div role="tablist" className={styles.tabs} aria-label={t("recipe.editor.section")}>
      {sections.map(({ id, label }, index) => (
        <button key={id} ref={el => { tabs.current[index] = el; }} type="button" role="tab" id={"tab-" + id}
          aria-selected={active === id} aria-controls={id} tabIndex={active === id ? 0 : -1}
          onClick={() => onSelect(id)}
          onKeyDown={event => {
            let next = index;
            if (event.key === "ArrowRight") next = (index + 1) % sections.length;
            else if (event.key === "ArrowLeft") next = (index + sections.length - 1) % sections.length;
            else if (event.key === "Home") next = 0;
            else if (event.key === "End") next = sections.length - 1;
            else return;
            event.preventDefault();
            tabs.current[next]?.focus({ preventScroll: true });
            onSelect(sections[next].id);
          }}>
          {t(label)}{counts[id] != null && <span className={styles.count}>{counts[id]}</span>}
        </button>
      ))}
    </div>
    <div className={styles.sectionSelect}>
      <select aria-label={t("recipe.editor.section")} value={active} onChange={event => onSelect(event.target.value as SectionId)}>
        {sections.map(({ id, label }) => <option key={id} value={id}>{t(label)}{counts[id] != null ? " (" + counts[id] + ")" : ""}</option>)}
      </select>
      <Icon name="chevronDown" size={17} />
    </div>
  </>;
}
