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

## Parser contract

`frontend/src/lib/day5TutorResponse.raw.fixture.md` is the exact full tutor response that exposed the display-math bug. Its manually reviewed canonical result is stored beside it as `day5TutorResponse.expected.fixture.md`. The test verifies byte-for-byte normalization, idempotence, all 20 answer sections, and KaTeX validity for every display formula.

Focused tests also preserve the earlier regressions: heading-corrupted display delimiters, lost subtraction rows, malformed bracket displays, short display equations, block quotes, fenced code, and follow-up labels.

## Failure rules

- UUIDs are authoritative; readable labels are never foreign keys.
- Prompt labels are resolved only within the owning discussion's prompt batches.
- Ambiguous or missing mappings fail closed instead of guessing another annotation.
- Updating content and updating identity are separate operations.
- Position, current open-question order, and creation date are never identity.
- Every destructive QA edit is reconstructed from stable section keys and persists through document revisions.

These invariants are enforced by migration `0019_stable_question_identities.sql` and covered by backend, prompt-generation, discussion-mapping, QA-deletion, and full-response parser tests.
