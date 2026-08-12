import { describe, it, expect } from "vitest";
import { withNewJob, withoutJob, withFailedAttempt, type QueuedPrintJob } from "../lib/print-queue";

function job(overrides: Partial<QueuedPrintJob> = {}): QueuedPrintJob {
  return {
    id: "job-1",
    kind: "receipt",
    doc: { rows: [] },
    drawer: false,
    createdAt: "2026-08-12T20:00:00Z",
    attempts: 1,
    ...overrides,
  };
}

describe("print queue — pure list operations", () => {
  it("withNewJob appends without mutating the original array", () => {
    const original: QueuedPrintJob[] = [];
    const result = withNewJob(original, job());
    expect(original).toHaveLength(0);
    expect(result).toHaveLength(1);
  });

  it("withoutJob removes only the matching id", () => {
    const jobs = [job({ id: "a" }), job({ id: "b" })];
    const result = withoutJob(jobs, "a");
    expect(result.map((j) => j.id)).toEqual(["b"]);
  });

  it("withFailedAttempt increments attempts and records the error, leaving other jobs untouched", () => {
    const jobs = [job({ id: "a", attempts: 1 }), job({ id: "b", attempts: 1 })];
    const result = withFailedAttempt(jobs, "a", "printer offline");
    const a = result.find((j) => j.id === "a")!;
    const b = result.find((j) => j.id === "b")!;
    expect(a.attempts).toBe(2);
    expect(a.lastError).toBe("printer offline");
    expect(b.attempts).toBe(1);
    expect(b.lastError).toBeUndefined();
  });
});
