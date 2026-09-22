"use client";

import { Children, useLayoutEffect, useRef, type ReactNode } from "react";
import styles from "./LibraryPage.module.css";

export function LibraryMasonry({ children }: { children: ReactNode }) {
  const gridRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const items = Array.from(grid.children) as HTMLElement[];
    let frame = 0;
    let observedWidth = 0;

    function layout() {
      if (!grid) return;
      const style = getComputedStyle(grid);
      const columnCount = Number(style.getPropertyValue("--library-columns")) || 1;
      const columnGap = parseFloat(style.columnGap);
      const rowGap = parseFloat(style.rowGap);
      const columnWidth = (grid.getBoundingClientRect().width - columnGap * (columnCount - 1)) / columnCount;

      // Apply the responsive widths before reading natural card heights.
      grid.dataset.layout = "masonry";
      const heights = items.map((item) => item.getBoundingClientRect().height);
      const bottoms = Array<number>(columnCount).fill(0);
      items.forEach((item, index) => {
        const column = bottoms.indexOf(Math.min(...bottoms));
        item.style.transform = `translate(${column * (columnWidth + columnGap)}px, ${bottoms[column]}px)`;
        bottoms[column] += heights[index] + rowGap;
      });
      grid.style.height = `${Math.max(0, ...bottoms) - (items.length ? rowGap : 0)}px`;
    }

    function scheduleLayout() {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(layout);
    }

    layout();
    const observer = new ResizeObserver((entries) => {
      let changed = false;
      for (const entry of entries) {
        if (entry.target !== grid) {
          changed = true;
        } else if (entry.contentRect.width !== observedWidth) {
          observedWidth = entry.contentRect.width;
          changed = true;
        }
      }
      if (changed) scheduleLayout();
    });
    observer.observe(grid);
    items.forEach((item) => observer.observe(item));
    window.addEventListener("resize", scheduleLayout);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", scheduleLayout);
    };
  }, [children]);

  return (
    <div ref={gridRef} className={styles.grid} role="list">
      {Children.map(children, (child) => <div className={styles.masonryItem}>{child}</div>)}
    </div>
  );
}
