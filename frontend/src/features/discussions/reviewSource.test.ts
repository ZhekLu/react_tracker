import { describe, expect, it } from 'vitest';
import type { Annotation, Discussion } from '../../types/tracker';
import { qaReviewThreads, qaReviewStatus, qaSectionFingerprint } from './discussionQaReviewModel';
import { discussionQaSections } from '../../lib/discussionQa';

const source = {id:'source', resourceId:'book', kind:'question', status:'open', origin:'discussion_review_source', createdAt:'2026-09-01', anchor:{discussionMessageId:'note'}} as unknown as Annotation;
const followup = {id:'followup', resourceId:'book', kind:'question', status:'open', origin:'discussion_review_followup', createdAt:'2026-09-02', anchor:{discussionMessageId:'note', metadata:{rootQuestionIds:['source'], promptLabel:'Q-001-F1'}}} as unknown as Annotation;
const discussion = {id:'daily', initialPromptBatchId:'batch', questionIds:['source','followup'], questionLabels:[], qaReviews:[], messages:[{
  id:'note', role:'assistant', createdAt:'2026-09-01', sequenceNumber:1, body:{markdown:'Introduction.\n\n## Day 10\n\nFirst part.\n\n## Replay\n\nSecond part.'}, annotationLinks:[{annotationId:'source',relation:'references'},{annotationId:'followup',relation:'followup_to'}],
},{id:'reply',role:'assistant',createdAt:'2026-09-02',sequenceNumber:2,body:{markdown:'## Q-001-F1\n\nThe clarification.'},annotationLinks:[{annotationId:'followup',relation:'references'}]}]} as unknown as Discussion;

describe('standalone review sources', () => {
  it('keeps the whole note together and attaches subsequent follow-up answers to it', () => {
    const sections = discussionQaSections(discussion, [source,followup]);
    expect(sections[0].questionIds).toEqual(['source']);
    expect(sections[0].bodyMarkdown).toContain('Introduction.');
    expect(sections[0].bodyMarkdown).toContain('## Replay');
    const items = qaReviewThreads([discussion],[source,followup],discussion);
    expect(items).toHaveLength(1);
    expect(items[0].rootQuestions?.map(q=>q.id)).toEqual(['source']);
    expect(items[0].questions.map(q=>q.id)).toEqual(['source','followup']);
    expect(items[0].answers?.map(answer=>answer.section.messageId)).toEqual(['note','reply']);
  });
  it('preserves review status across reopening without adding sources to unrelated scoped question reviews', () => {
    const noteOnly = {...discussion,messages:[discussion.messages[0]],questionIds:['source']};
    const [item] = qaReviewThreads([noteOnly],[source],noteOnly);
    expect(qaReviewStatus(item,[{annotationId:'source',discussionId:'daily',messageId:'note',messageRevision:1,sectionId:item.section!.id,sectionFingerprint:qaSectionFingerprint(item.section!),viewedAt:'2026-09-02'}])).toBe('viewed');
    expect(qaReviewThreads([noteOnly],[source],noteOnly,['unrelated'])).toHaveLength(0);
  });
});
