import { expect, test } from "vitest";
import { formatWeekRangeDisplay } from "./week";
test("formats shopping weeks in the selected language across month boundaries", () => {
 expect(formatWeekRangeDisplay("2026-09-28","2026-10-04","zh")).toBe("9月28日 — 10月4日");
 expect(formatWeekRangeDisplay("2026-09-21","2026-09-27","zh")).toBe("9月21日 — 27日");
 expect(formatWeekRangeDisplay("2026-09-28","2026-10-04")).toBe("Sep 28 — Oct 4");
});
