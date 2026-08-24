# Discussion and question data integrity

The tracker separates machine identity from human-readable identity:

- `annotations.id` is the canonical UUID used by foreign keys and API mutations.
- `question_identities.id` is the canonical UUID for one logical question. Multiple PDF captures in the same context group may point to it.
- `question_identities.readable_label` is an immutable display/prompt label such as `Q-b-05-009`.
- `prompt_batch_items.question_label` is the exact label copied in a particular prompt. Historical prompts that used `Q-009` remain valid aliases; new prompts use the immutable readable label.

## Readable-label format

`Q-<resource>-<scope>-<ordinal>` is assigned once when the question is created:

- `b` is the main RL book and the scope is its chapter (`Q-b-05-009`).
- `us` is a UniPD slide deck and the scope is its lecture number (`Q-us-12-004`).
- papers, other slides, and uncommon resources receive a short deterministic resource code derived from their resource UUID.

The ordinal is local to the resource and scope. It is not recalculated when questions are archived, deleted, copied, postponed, or moved between discussions. Database triggers reject label or identity reassignment.

## Prompt and response flow

1. A question is created and receives its UUID plus immutable readable label.
2. Copying questions creates a prompt-batch snapshot. The batch records the annotation UUID, exact label, order, quoted source, and question text.
3. A pasted tutor response is parsed by its headings, then linked through that prompt batch. Mapping is scoped to the discussion and batch; the application never resolves an answer by a global `Q-001` lookup.
4. Follow-ups keep the original root label and add an `-F<n>` suffix.
5. QA editor sections use a key derived from message UUID, prompt label, heading, and same-heading occurrence. Array position is deliberately excluded: deleting an earlier answer cannot move a stale draft under a later heading.

The pasted response is only an import envelope. It is never stored as one large
discussion message. Each mapped answer becomes its own assistant message with
its own document, annotation UUID links, revision history, editor state, and
delete lifecycle. A second paste for the same question creates another answer
version linked to the same canonical question rather than overwriting or
duplicating the question.

QA state belongs to the canonical annotation, not to an answer or exercise
projection. `annotations.status`, `postponed_at`, and `skipped_at` are the
authoritative understood/later/skipped state. A QA visit stores the exact answer
section ID and a content fingerprint. Editing a sibling answer therefore cannot
make an old understood question appear updated. Exercise badges are projections
of explicit `note_links` rows to the annotation UUID; matching prose such as
"Exercise 5.5" is never treated as a relationship.

## Parser contract

`frontend/src/lib/chapter5TutorResponse.raw.fixture.md` is the exact full tutor
response that exposed the display-math bug. Its manually reviewed canonical
result is stored beside it as
`chapter5TutorResponse.expected.fixture.md`. The test verifies byte-for-byte
normalization, idempotence, answer headings, and KaTeX validity for every
display formula.

Import boundaries never discard prose:

- a preamble before the first `Q-...` heading is folded into the first answer;
- a postscript and additional/nested headings remain in the surrounding or
  final answer;
- without `Q-...` headings, `Exercise ...` headings are accepted as explicit
  answer boundaries, with shared introductory prose folded into the first;
- generic headings alone do not manufacture fake QA cards: the response is
  stored as one independent answer.

Focused tests also preserve the earlier regressions: heading-corrupted display delimiters, lost subtraction rows, malformed bracket displays, short display equations, block quotes, fenced code, and follow-up labels.

## Failure rules

- UUIDs are authoritative; readable labels are never foreign keys.
- Prompt labels are resolved only within the owning discussion's prompt batches.
- Ambiguous or missing mappings fail closed instead of guessing another annotation.
- Updating content and updating identity are separate operations.
- Position, current open-question order, and creation date are never identity.
- Every destructive QA edit is reconstructed from stable section keys and persists through document revisions.

These invariants are enforced by migrations
`0019_stable_question_identities.sql` and
`0020_qa_review_section_fingerprints.sql`, and covered by backend,
prompt-generation, discussion-mapping, QA-state, QA-deletion, independent-answer
import, and full-response parser tests.
