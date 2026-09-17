import { describe, expect, it } from "vitest";
import type { Annotation, Course, Discussion } from "../../types/tracker";
import { buildQuestionIndex, searchQuestions } from "./questionSearchModel";
const question = (id: string, stableLabel: string, body: string): Annotation => ({id, stableLabel, resourceId:"book", kind:"question", status:"open", origin:"manual", createdAt:"2026-09-01", updatedAt:"2026-09-01", body:{markdown:body, plainText:body}, anchor:{metadata:{}}} as Annotation);
const thread = (id: string, questionId: string, markdown: string): Discussion => ({id, title:id, sourceResourceIds:["book"], status:"active", scopeType:"resource", questionIds:[questionId], questionLabels:[{label:"Q-001",annotationIds:[questionId]}], qaReviews:[], messages:[{id:`m-${id}`, role:"assistant", createdAt:"2026-09-02", sequenceNumber:1, body:{markdown,plainText:markdown}, annotationLinks:[{annotationId:questionId,relation:"references"}]}]} as unknown as Discussion);
const course = (annotations: Annotation[], discussions: Discussion[]): Course => ({annotations,discussions,resources:[{id:"book",title:"Learning theory"}]} as Course);

describe("course-wide question finder", () => {
  it("finds unreviewed answers and keeps reused prompt aliases scoped by UUID", () => {
    const index = buildQuestionIndex(course([question("a","RL-Q-010","Why converge?"),question("b","RL-Q-020","What is entropy?")],[thread("first","a","## Q-001\n\nA contraction mapping."),thread("second","b","## Q-001\n\nAn information measure.")]));
    expect(searchQuestions(index,"contraction").map(e => e.label)).toEqual(["RL-Q-010"]);
    expect(searchQuestions(index,"Q-001")).toHaveLength(2);
    expect(searchQuestions(index,"RL Q 020")[0].answers[0].discussion.id).toBe("second");
    expect(index.every(e => e.status === "to-review")).toBe(true);
  });
  it("groups multiple captures and searches source context and question text", () => {
    const a = question("a","Q-042","Bellman contraction");
    const b = {...a,id:"b"};
    const index = buildQuestionIndex(course([a,b],[thread("t","b","A complete answer.")]));
    expect(index).toHaveLength(1);
    expect(searchQuestions(index,"theory Bellman")[0].questions).toHaveLength(2);
    expect(index[0].answers).toHaveLength(1);
  });
  it("distinguishes unanswered, understood, later, archived, and unlinked responses", () => {
    const annotations = [question("a","Q-1","Unanswered"),{...question("b","Q-2","Archived"),status:"archived" as const},{...question("c","Q-3","Later"),postponed:true}];
    const index = buildQuestionIndex(course(annotations,[thread("unlinked","deleted-question","Still useful response.")]));
    expect(searchQuestions(index,"")).toHaveLength(3);
    expect(searchQuestions(index,"","archived")).toHaveLength(1);
    expect(searchQuestions(index,"","no-response")[0].questions[0].id).toBe("a");
    expect(searchQuestions(index,"","later")[0].questions[0].id).toBe("c");
    expect(searchQuestions(index,"useful")[0].status).toBe("unlinked");
  });
  it("does not index empty deleted-answer shells", () => {
    expect(buildQuestionIndex(course([], [thread("empty","gone", "  ")]))).toEqual([]);
  });
});

it("treats complete IDs as phrases instead of unrelated number fragments", () => {
  const index = buildQuestionIndex(course([question("a","Q-b-13-013","one"),question("b","Q-b-11-013","Chapter 13 elsewhere")],[]));
  expect(searchQuestions(index,"Q-b-13-013").map(e => e.label)).toEqual(["Q-b-13-013"]);
});
