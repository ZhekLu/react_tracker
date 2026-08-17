import { annotationDisplayText } from "../../components/annotations/annotationDisplay";
import promptTemplates from "../../config/promptTemplates.json";
import type { Annotation, Course, Discussion } from "../../types/tracker";
import { discussionQaSections } from "../../lib/discussionQa";
import { qaReviewThreads } from "./discussionQaReviewModel";

function annotationNotes(annotation: Annotation): string {
  return annotation.notes
    .map((note) => note.document.markdown ?? note.document.plainText)
    .map((text) => text.trim())
    .filter(Boolean)
    .join("\n\n");
}

function readableQuestionLabel(
  course: Course,
  activeDiscussion: Discussion,
  annotationId: string,
): string {
  const matches = course.discussions.flatMap((discussion) =>
    discussion.questionLabels
      .filter((entry) => entry.annotationIds.includes(annotationId))
      .map((entry) => ({ discussion, label: entry.label })),
  );
  const active = matches.find((match) => match.discussion.id === activeDiscussion.id);
  if (active) return active.label;
  const first = matches[0];
  return first ? `${first.label} · ${first.discussion.title}` : "Tracker question";
}

function sourceLine(course: Course, annotation: Annotation): string {
  const resource = course.resources.find((item) => item.id === annotation.resourceId);
  return [
    resource?.title,
    annotation.anchor?.pageNumber ? `p. ${annotation.anchor.pageNumber}` : "",
    annotation.anchor?.sectionTitle,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** Export the same UUID-backed question threads shown by focused QA review. */
export function discussionReviewPrompt(
  course: Course,
  discussion: Discussion,
): string {
  const threads = qaReviewThreads(
    course.discussions,
    course.annotations,
    discussion,
  );
  const includedSectionIds = new Set(
    threads.flatMap((thread) =>
      (thread.answers ?? []).map((answer) => answer.section.id),
    ),
  );
  const threadMarkdown = threads.map((thread, threadIndex) => {
    const roots = thread.rootQuestions ?? [];
    const followups = thread.questions.filter(
      (question) => question.origin === "discussion_review_followup",
    );
    const title = roots.length
      ? roots
          .map((question) => readableQuestionLabel(course, discussion, question.id))
          .join(" / ")
      : thread.section?.title ?? `Review section ${threadIndex + 1}`;
    const questionBlocks = roots.map((question) => {
      const notes = annotationNotes(question);
      return [
        `### Original question · ${question.status}${question.postponed ? " · later" : ""}`,
        sourceLine(course, question),
        annotationDisplayText(question),
        notes ? `#### My note / attempted solution\n\n${notes}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
    });
    const answers = (thread.answers ?? []).map((answer, answerIndex) => {
      const messageImportant = course.notes.some(
        (note) =>
          note.kind === "important_answer" &&
          note.status === "active" &&
          note.links.some(
            (link) =>
              link.entityType === "discussion_message" &&
              link.entityId === answer.section.messageId,
          ),
      );
      return [
        `### Tutor response ${answerIndex + 1}${messageImportant ? " · IMPORTANT" : ""}`,
        answer.section.bodyMarkdown,
      ].join("\n\n");
    });
    const followupBlocks = followups.map((followup, index) => {
      const selected = followup.anchor?.quote?.trim();
      return [
        `### My follow-up ${index + 1} · ${followup.status}`,
        selected ? `Selected answer context:\n\n> ${selected.replaceAll("\n", "\n> ")}` : "",
        annotationDisplayText(followup),
      ]
        .filter(Boolean)
        .join("\n\n");
    });
    return [
      `## ${title}`,
      ...questionBlocks,
      ...answers,
      ...followupBlocks,
    ]
      .filter(Boolean)
      .join("\n\n");
  });
  const otherSections = discussionQaSections(discussion, course.annotations)
    .filter((section) => !includedSectionIds.has(section.id))
    .map(
      (section, index) =>
        `## Other section ${index + 1} · ${section.title}\n\n${section.bodyMarkdown}`,
    );
  return [
    `# Discussion review: ${discussion.title}`,
    `Course: ${course.title}`,
    "",
    ...threadMarkdown,
    ...otherSections,
    "## Review request",
    promptTemplates.discussionReviewRequest,
  ]
    .filter(Boolean)
    .join("\n\n");
}
