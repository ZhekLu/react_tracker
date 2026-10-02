import type { Course, Discussion } from "../../types/tracker";
import { discussionQaSections } from "../../lib/discussionQa";
import { discussionPriority } from "../../lib/discussionPriority";
import { buildDiscussionStudy, importantAnswerNote, type StudyAnswer } from "./discussionStudyModel";

/** History indexes each response once, across messages, under its original source. */
export function buildDiscussionHistory(course: Course, discussion: Discussion): StudyAnswer[] {
  const threads = buildDiscussionStudy(course, discussion);
  const owners = new Map(threads.flatMap(thread => (thread.item.answers ?? []).map(answer => [answer.section.id, thread] as const)));
  return discussionQaSections(discussion, course.annotations).filter(s => s.bodyMarkdown.trim()).map((section, order) => {
    const owner = owners.get(section.id);
    const questions = owner?.item.questions ?? course.annotations.filter(a => section.questionIds.includes(a.id));
    const base: StudyAnswer = owner ?? {id: section.id, title: section.title, preview: "", priority: "unrated", sourceIds: [],
      groupId: "context", groupTitle: "Discussion notes", understood: false, order, item: {id: section.id, questions}};
    return {...base, id: section.id, order, title: section.title,
      priority: discussionPriority(section.bodyMarkdown, questions),
      importantNote: importantAnswerNote(course.notes, questions, [section]),
      item: {...base.item, id: section.id, section, sectionDiscussionId: discussion.id, answers: [{discussionId: discussion.id, section}]},
    };
  }).sort((a, b) => b.item.section!.messageSequenceNumber - a.item.section!.messageSequenceNumber || a.order - b.order);
}
