import { describe, expect, it } from "vitest";
import type { Note } from "../types/tracker";
import {
  nextExerciseStatus,
  parseExerciseProgress,
  serializeExerciseProgress,
} from "./exerciseProgress";

describe("exercise progress", () => {
  it("round-trips a compact chapter exercise map", () => {
    const progress = {
      "6.1": "read_fully" as const,
      "6.2": "read_partially" as const,
      "6.13": "unread" as const,
    };
    const markdown = serializeExerciseProgress(progress);
    const note = {
      document: { markdown, plainText: markdown },
    } as Note;

    expect(parseExerciseProgress(note)).toEqual(progress);
    expect(markdown.indexOf("Exercise 6.2")).toBeLessThan(
      markdown.indexOf("Exercise 6.13"),
    );
  });

  it("cycles through attempted, complete, and reset", () => {
    expect(nextExerciseStatus("unread")).toBe("read_partially");
    expect(nextExerciseStatus("read_partially")).toBe("read_fully");
    expect(nextExerciseStatus("read_fully")).toBe("unread");
  });
});
