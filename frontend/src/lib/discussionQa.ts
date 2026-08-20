import type {
  Annotation,
  Discussion,
  DiscussionMessage,
} from "../types/tracker";
import {
  discussionAnswerSections,
  matchAnswerSectionsToQuestions,
  normalizeDiscussionMarkdown,
} from "./discussionText";

export type DiscussionQaSection = {
  bodyMarkdown: string;
  headingLine: string;
  id: string;
  kind: "answer" | "preamble" | "unstructured";
  label: string;
  messageId: string;
  messageSequenceNumber: number;
  questionIds: string[];
  sectionOrder: number;
  title: string;
};

export type ReconstructedQaMessage = {
  markdown: string;
  sectionBodyOffsets: Map<string, number>;
};

/**
 * Resolve readable Q-### and Q-###-Fn labels inside one discussion only.
 *
 * Prompt labels come from persisted prompt_batch_items. Review follow-ups keep
 * their persisted promptLabel when either their parent message or the response
 * that links them belongs to this exact discussion. The latter is what lets a
 * new discussion answer follow-ups created in an earlier one without sharing
 * either discussion's Q-001 namespace. UUIDs remain the identity used for every
 * join.
 */
export function discussionQuestionIdsByLabel(
  discussion: Discussion,
  annotations: Annotation[],
): Map<string, string[]> {
  const result = new Map(
    (discussion.questionLabels ?? []).map((item) => [
      item.label,
      [...item.annotationIds],
    ]),
  );
  const messageIds = new Set(discussion.messages.map((message) => message.id));
  const linkedAnnotationIds = new Set(
    discussion.messages.flatMap((message) =>
      message.annotationLinks.map((link) => link.annotationId),
    ),
  );
  for (const annotation of annotations) {
    if (
      annotation.origin !== "discussion_review_followup" ||
      (!messageIds.has(annotation.anchor?.discussionMessageId ?? "") &&
        !linkedAnnotationIds.has(annotation.id))
    ) {
      continue;
    }
    const label = annotation.anchor?.metadata?.promptLabel;
    if (typeof label !== "string") continue;
    const belongsToThisDiscussion = messageIds.has(
      annotation.anchor?.discussionMessageId ?? "",
    );
    if (
      !belongsToThisDiscussion &&
      (discussion.questionLabels ?? []).some(
        (item) =>
          item.label === label && !item.annotationIds.includes(annotation.id),
      )
    ) {
      // The imported follow-up reused a short label owned by this discussion's
      // prompt batch. Ambiguous labels fail closed; UUID identity is preserved
      // and the answer stays visibly unmapped rather than joining the wrong Q.
      continue;
    }
    const current = result.get(label) ?? [];
    if (!current.includes(annotation.id)) result.set(label, [...current, annotation.id]);
  }
  return result;
}

export function responseQuestionIds(
  discussion: Discussion,
  markdown: string,
  annotations: Annotation[],
  discussions: Discussion[],
): string[] {
  const labels = discussionAnswerSections(markdown).sections.flatMap(
    (section) => section.labels,
  );
  void discussions;
  const questionIdsByLabel = discussionQuestionIdsByLabel(
    discussion,
    annotations,
  );
  const ids = labels.length
    ? labels.flatMap((label) => questionIdsByLabel.get(label) ?? [])
    : discussion.questionIds.filter((id) => {
        const annotation = annotations.find((item) => item.id === id);
        return annotation?.status === "open" && !annotation.postponed;
      });
  return [...new Set(ids)];
}

function annotationText(annotation: Annotation): string {
  const body =
    annotation.body?.markdown ||
    annotation.body?.plainText ||
    "";
  const selectedContext =
    annotation.origin === "discussion_review_followup"
      ? annotation.anchor?.quote ?? ""
      : "";
  return (
    [selectedContext, body].filter(Boolean).join("\n\n") ||
    annotation.anchor?.quote ||
    "Question without text"
  );
}

function linkedQuestionCandidates(
  discussion: Discussion,
  message: DiscussionMessage,
  annotationById: Map<string, Annotation>,
): Annotation[] {
  const linkedQuestionIds = new Set(
    message.annotationLinks.map((link) => link.annotationId),
  );
  const orderedQuestionIds = [
    ...discussion.questionIds.filter((id) => linkedQuestionIds.has(id)),
    ...(
      discussion.initialPromptBatchId
        ? []
        : message.annotationLinks
            .map((link) => link.annotationId)
            .filter((id) => !discussion.questionIds.includes(id))
    ),
  ];
  const linkedQuestions = orderedQuestionIds
    .map((id) => annotationById.get(id))
    .filter(
      (annotation): annotation is Annotation =>
        Boolean(
          annotation && ["question", "todo"].includes(annotation.kind),
        ),
    );
  if (discussion.initialPromptBatchId) return linkedQuestions;
  return [...linkedQuestions].sort(
    (left, right) =>
      left.resourceId.localeCompare(right.resourceId) ||
      (left.anchor?.pageNumber ?? Number.MAX_SAFE_INTEGER) -
        (right.anchor?.pageNumber ?? Number.MAX_SAFE_INTEGER) ||
      (left.anchor?.rect?.[1] ?? Number.MAX_SAFE_INTEGER) -
        (right.anchor?.rect?.[1] ?? Number.MAX_SAFE_INTEGER) ||
      left.createdAt.localeCompare(right.createdAt),
  );
}

export function discussionQaSections(
  discussion: Discussion,
  annotations: Annotation[],
): DiscussionQaSection[] {
  const annotationById = new Map(
    annotations.map((annotation) => [annotation.id, annotation]),
  );
  const persistedQuestionIdsByLabel = discussionQuestionIdsByLabel(
    discussion,
    annotations,
  );
  return discussion.messages.flatMap((message) => {
    if (message.role !== "assistant") return [];
    const markdown = normalizeDiscussionMarkdown(
      message.body.markdown || message.body.plainText,
    );
    if (!markdown) return [];
    const questions = linkedQuestionCandidates(
      discussion,
      message,
      annotationById,
    );
    const parsed = discussionAnswerSections(markdown);
    if (!parsed.sections.length) {
      return [
        {
          bodyMarkdown: markdown,
          headingLine: "",
          id: `${message.id}:unstructured`,
          kind: "unstructured" as const,
          label: `Response #${message.sequenceNumber}`,
          messageId: message.id,
          messageSequenceNumber: message.sequenceNumber,
          questionIds: questions.map((question) => question.id),
          sectionOrder: 0,
          title: `Response #${message.sequenceNumber}`,
        },
      ];
    }
    const ordinaryQuestions = questions.filter(
      (question) => question.origin !== "discussion_review_followup",
    );
    const followupQuestions = questions.filter(
      (question) => question.origin === "discussion_review_followup",
    );
    const hasPersistedLabelNamespace = persistedQuestionIdsByLabel.size > 0;
    const questionIdsByLabel = hasPersistedLabelNamespace
      ? new Map(
          parsed.sections.map((section) => [
            section.label,
            [...new Set(
              section.labels.flatMap(
                (label) => persistedQuestionIdsByLabel.get(label) ?? [],
              ),
            )],
          ]),
        )
      : new Map(
          matchAnswerSectionsToQuestions(
            parsed.sections,
            ordinaryQuestions.map((question) => ({
              id: question.id,
              text: annotationText(question),
            })),
            false,
          ).map((match) => [match.sectionLabel, match.questionIds]),
        );
    for (const followup of followupQuestions) {
      const promptLabel = followup.anchor?.metadata?.promptLabel;
      const promptLabelQuestionIds =
        typeof promptLabel === "string"
          ? persistedQuestionIdsByLabel.get(promptLabel) ?? []
          : [];
      if (
        typeof promptLabel === "string" &&
        promptLabelQuestionIds.includes(followup.id)
      ) {
        const directSection = parsed.sections.find((section) =>
          section.labels.includes(promptLabel),
        );
        if (directSection) {
          const existing = questionIdsByLabel.get(directSection.label) ?? [];
          questionIdsByLabel.set(
            directSection.label,
            [...new Set([...existing, followup.id])],
          );
          continue;
        }
      }
      // A prompt-batch discussion has an explicit label namespace. If a label
      // is not in it, leave the response unmapped instead of guessing by text.
      // Semantic recovery is retained only for legacy free-form discussions.
      if (hasPersistedLabelNamespace) continue;
      const followupMatch = matchAnswerSectionsToQuestions(
        parsed.sections,
        [{ id: followup.id, text: annotationText(followup) }],
        false,
      )[0];
      if (!followupMatch) continue;
      const existing = questionIdsByLabel.get(followupMatch.sectionLabel) ?? [];
      questionIdsByLabel.set(
        followupMatch.sectionLabel,
        [...existing, followup.id],
      );
    }
    const sections: DiscussionQaSection[] = [];
    if (parsed.preamble) {
      sections.push({
        bodyMarkdown: parsed.preamble,
        headingLine: "",
        id: `${message.id}:preamble`,
        kind: "preamble",
        label: "Introduction",
        messageId: message.id,
        messageSequenceNumber: message.sequenceNumber,
        questionIds: [],
        sectionOrder: -1,
        title: "Introduction",
      });
    }
    parsed.sections.forEach((section, index) => {
      const headingLine = section.markdown.match(/^#{1,6}\s+.+$/m)?.[0] ?? "";
      sections.push({
        bodyMarkdown: section.markdown.replace(
          /^#{1,6}\s+.+(?:\n+|$)/,
          "",
        ),
        headingLine,
        id: `${message.id}:answer:${index}`,
        kind: "answer",
        label: section.label,
        messageId: message.id,
        messageSequenceNumber: message.sequenceNumber,
        questionIds: questionIdsByLabel.get(section.label) ?? [],
        sectionOrder: index,
        title:
          headingLine.match(/^#{1,6}\s+(.+)$/)?.[1] ?? section.label,
      });
    });
    return sections;
  });
}

export function reconstructQaMessage(
  sections: DiscussionQaSection[],
  drafts: ReadonlyMap<string, string>,
): ReconstructedQaMessage {
  const blocks: string[] = [];
  const sectionBodyOffsets = new Map<string, number>();
  let cursor = 0;
  for (const section of sections) {
    const body = normalizeDiscussionMarkdown(
      drafts.get(section.id) ?? section.bodyMarkdown,
    );
    const block = [section.headingLine, body].filter(Boolean).join("\n\n");
    if (blocks.length) cursor += 2;
    sectionBodyOffsets.set(
      section.id,
      cursor + (section.headingLine ? section.headingLine.length + 2 : 0),
    );
    blocks.push(block);
    cursor += block.length;
  }
  return {
    markdown: normalizeDiscussionMarkdown(blocks.join("\n\n")),
    sectionBodyOffsets,
  };
}
