import type {
  Annotation,
  Discussion,
  DiscussionMessage,
} from "../types/tracker";
import {
  discussionAnswerSections,
  discussionSectionSearchText,
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

export type NormalizedTutorAnswer = {
  annotationIds: string[];
  markdown: string;
  plainText: string;
};

type TutorAnswerEnvelope = {
  markdown: string;
  preamble: string;
};

function exerciseAnswerEnvelopes(markdown: string): TutorAnswerEnvelope[] {
  const headings = [...discussionSectionSearchText(markdown).matchAll(/^(#{1,6})[ \t]+(.+)$/gm)]
    .map((match) => ({
      index: match.index ?? 0,
      level: match[1].length,
      title: match[2].replace(/[*_`]/g, "").trim(),
    }))
    .filter((heading) =>
      /^Exercises?\s+\d+(?:\.\d+)+(?:\b|\s|[,/&-])/i.test(heading.title),
    );
  if (!headings.length) return [];
  const boundaryLevel = Math.min(...headings.map((heading) => heading.level));
  const boundaries = headings.filter((heading) => heading.level === boundaryLevel);
  return boundaries.map((heading, index) => ({
    markdown: markdown
      .slice(heading.index, boundaries[index + 1]?.index ?? markdown.length)
      .trim(),
    preamble: index === 0 ? markdown.slice(0, heading.index).trim() : "",
  }));
}

function qaSectionIdentity(
  messageId: string,
  label: string,
  headingLine: string,
  occurrence: number,
): string {
  // Array positions are not identities: deleting Q-011 used to rename Q-012
  // to the former Q-011 editor key, which then saved Q-011's draft underneath
  // Q-012.  A section's persisted prompt label and heading remain stable when
  // neighboring answers are edited or removed.  The occurrence only
  // distinguishes intentional v2 answers with an identical heading.
  return [
    messageId,
    "answer",
    encodeURIComponent(label.toLowerCase()),
    encodeURIComponent(headingLine.toLowerCase()),
    occurrence,
  ].join(":");
}

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
  // Only explicit labels establish an automatic relationship. A free-form
  // note is not an answer to every currently open question in this discussion.
  const ids = labels.flatMap((label) => questionIdsByLabel.get(label) ?? []);
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
    message.annotationLinks.filter(link => link.relation !== "followup_to").map((link) => link.annotationId),
  );
  const orderedQuestionIds = [
    ...discussion.questionIds.filter((id) => linkedQuestionIds.has(id)),
    ...(
      discussion.initialPromptBatchId
        ? message.annotationLinks.filter(link => link.relation !== "followup_to").map(link => link.annotationId).filter(id =>
            annotationById.get(id)?.origin === "discussion_review_source" && !discussion.questionIds.includes(id))
        : message.annotationLinks.filter(link => link.relation !== "followup_to")
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
    const reviewSources = questions.filter(question => question.origin === "discussion_review_source");
    if (!parsed.sections.length || reviewSources.length) {
      return [
        {
          bodyMarkdown: markdown,
          headingLine: "",
          id: `${message.id}:unstructured`,
          kind: "unstructured" as const,
          label: `Response #${message.sequenceNumber}`,
          messageId: message.id,
          messageSequenceNumber: message.sequenceNumber,
          questionIds: (reviewSources.length ? reviewSources : questions).map((question) => question.id),
          sectionOrder: 0,
          title: markdown.match(/^#{1,6}\s+(.+)$/m)?.[1] ?? `Response #${message.sequenceNumber}`,
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
    const headingOccurrences = new Map<string, number>();
    parsed.sections.forEach((section, index) => {
      const headingLine = section.markdown.match(/^#{1,6}\s+.+$/m)?.[0] ?? "";
      const occurrenceKey = `${section.label}\u0000${headingLine}`;
      const occurrence = (headingOccurrences.get(occurrenceKey) ?? 0) + 1;
      headingOccurrences.set(occurrenceKey, occurrence);
      sections.push({
        bodyMarkdown: section.markdown.replace(
          /^#{1,6}\s+.+(?:\n+|$)/,
          "",
        ),
        headingLine,
        id: qaSectionIdentity(
          message.id,
          section.label,
          headingLine,
          occurrence,
        ),
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

/**
 * Split one pasted tutor response into independently editable answer records.
 *
 * The pasted response is an import envelope, not a persisted entity. Question
 * headings are authoritative boundaries. Introductory prose is folded into the
 * first answer, postscript prose naturally remains in the final answer, and
 * nested/non-question headings remain part of their surrounding answer. When
 * there are no question headings, explicit Exercise headings are accepted as
 * boundaries; generic headings alone remain one answer.
 */
export function normalizeTutorAnswerInstances(
  discussion: Discussion | undefined,
  annotations: Annotation[],
  markdownInput: string,
  annotationIds: readonly string[] = [],
): NormalizedTutorAnswer[] {
  const markdown = normalizeDiscussionMarkdown(markdownInput);
  if (!markdown) return [];
  const parsedEnvelope = discussionAnswerSections(markdown);
  const hasQuestionHeadings = parsedEnvelope.sections.some(
    (section) => section.labels.length > 0,
  );
  if (!hasQuestionHeadings) {
    const exerciseEnvelopes = exerciseAnswerEnvelopes(markdown);
    const linkedIds = [...new Set(annotationIds)];
    if (!exerciseEnvelopes.length) {
      return [{
        annotationIds: linkedIds,
        markdown,
        plainText: markdown,
      }];
    }
    return exerciseEnvelopes.map((answer) => {
      const answerMarkdown = normalizeDiscussionMarkdown(
        [answer.preamble, answer.markdown].filter(Boolean).join("\n\n"),
      );
      return {
        annotationIds: exerciseEnvelopes.length === 1 ? linkedIds : [],
        markdown: answerMarkdown,
        plainText: answerMarkdown,
      };
    });
  }
  const baseDiscussion =
    discussion ??
    ({
      initialPromptBatchId: null,
      messages: [],
      questionIds: [],
      questionLabels: [],
    } as unknown as Discussion);
  const pendingMessageId = "__pending_tutor_answer_import__";
  const sequenceNumber =
    Math.max(0, ...baseDiscussion.messages.map((message) => message.sequenceNumber)) + 1;
  const linkedIds = [...new Set(annotationIds)];
  const transient = {
    ...baseDiscussion,
    messages: [
      ...baseDiscussion.messages,
      {
        annotationLinks: linkedIds.map((annotationId) => ({
          annotationId,
          relation: "references" as const,
        })),
        body: {
          canonicalFormat: "markdown" as const,
          id: `${pendingMessageId}:document`,
          markdown,
          plainText: markdown,
          revision: 1,
          updatedAt: "",
        },
        createdAt: "",
        id: pendingMessageId,
        importedFromClipboard: true,
        revision: 1,
        role: "assistant" as const,
        sequenceNumber,
      },
    ],
    questionIds: [...new Set([...baseDiscussion.questionIds, ...linkedIds])],
  } satisfies Discussion;
  const sections = discussionQaSections(transient, annotations).filter(
    (section) => section.messageId === pendingMessageId,
  );
  const preamble = sections.find((section) => section.kind === "preamble");
  const answerSections = sections.filter(
    (section) => section.kind === "answer" || section.kind === "unstructured",
  );
  if (!answerSections.length) {
    return [{ annotationIds: linkedIds, markdown, plainText: markdown }];
  }
  return answerSections.map((section, index) => {
    const answerMarkdown = normalizeDiscussionMarkdown(
      [
        index === 0 ? preamble?.bodyMarkdown ?? "" : "",
        section.headingLine,
        section.bodyMarkdown,
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
    const sectionAnnotationIds = [...new Set(section.questionIds)];
    return {
      annotationIds:
        answerSections.length === 1 && !sectionAnnotationIds.length
          ? linkedIds
          : sectionAnnotationIds,
      markdown: answerMarkdown,
      plainText: answerMarkdown,
    };
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
