import { expect, test } from "vitest";
import { PUBLIC_DOCUMENTS } from "./documents";
test("readiness notice preserves live analytics lifecycles and actual provider disclosures", () => {
 const text=JSON.stringify(PUBLIC_DOCUMENTS.privacy);
 for(const detail of ["OpenAI","Google Gemini","90 days","13 months","Do Not Track","Global Privacy Control","Settings","queues removal","snapshot","temporary copy","Older image objects"]) expect(text).toContain(detail);
 expect(text).not.toContain("not currently available as a self-service");
 expect(JSON.stringify(PUBLIC_DOCUMENTS.terms)).toContain("report");
});

test("restored sharing notice keeps deletion and does not promise removed safeguards", () => {
 const text=JSON.stringify(PUBLIC_DOCUMENTS);
 expect(text).toContain("confirm using your account password");
 expect(text).toContain("OpenAI and Google Gemini");
 for(const removed of ["await review", "approved for display", "review decisions", "block another account", "report shared recipes"]) expect(text).not.toContain(removed);
});
