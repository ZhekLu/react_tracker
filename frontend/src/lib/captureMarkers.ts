import type { ResourceCaptureInput } from "../components/annotations/InlineCaptureEditor";

export function normalizedCaptureInput(
  input: ResourceCaptureInput,
): ResourceCaptureInput {
  const todoMarker = /\btodo!/i.test(input.markdown);
  const questionMarker = input.markdown.includes("??");
  const kind = todoMarker
    ? "todo"
    : questionMarker
      ? "question"
      : input.kind;
  const color =
    input.color ||
    (kind === "question"
      ? "rgb(226, 82, 117)"
      : kind === "todo"
        ? "rgb(147, 178, 80)"
        : kind === "note"
          ? "rgb(141, 203, 219)"
          : undefined);
  return { ...input, color, kind };
}
