# Study flow audit · 25 September 2026

## Toggl reconciliation

The previous status poll refreshed day totals but reconciled task mirrors only
on a forced sync. New entry IDs created by resuming a timer in another client
were never imported. Force also bypassed backoff, and timer switching repeated
the current-entry request.

Every fresh, valid project snapshot now reconciles tasks. Exact descriptions
reuse a unique historical task binding; ambiguous names remain at day level.
Existing entry IDs retain their stable task binding. Remote edits and deletions
are applied within the fetched window. New descriptions with a recognized
`[CourseCode] Day N` prefix can contribute to their day without inventing a task.
Use a tracker-started task's exact description and project when resuming it.

The default interval is ten minutes while the app is visible (two reads per
refresh). Focus checks the shared server cache. **Sync Toggl time** in the header
requests an earlier sync with a 60-second minimum; it cannot override backoff.
Start/stop still preflight the current timer. A persistent local quota allows
at most 24 requests/hour in each of the user/workspace buckets, leaving some
headroom under Free's 30/hour limits. HTTP 402/429 pause requests for at least
an hour; other integrations' usage is not observable by this local counter.

Successful sync time appears in the sync button tooltip. Invalid or suspiciously
full (1,000+ entries) snapshots cannot delete local mirrors. Failed refreshes keep
cached totals. A successful start remains attached to its task even if the
following read fails. Task time freezes at the last successful snapshot during
an outage when that timestamp is available.

Limits: historical coverage follows `stats_start_date` / `stats_since_days`;
very large histories need a paginated/incremental sync in a future change.
Ambiguous task titles need manual distinction before automatic task assignment.
The quota assumes this single backend process; multiple independent installations
and third-party clients share Toggl's upstream allowance.

Sources checked 25 September 2026:
- [API limits](https://support.toggl.com/api-webhook-limits)
- [Time-entry API](https://engineering.toggl.com/docs/track/api/time_entries/)

## Reading annotations

The paragraph view duplicated each highlight as a full capture card. Reading mode
now places page metadata in a quiet margin and keeps capture management behind
the exact highlighted text (or the capture-count button). Overlapping highlights
open their corresponding captures together. The original colours are preserved;
stars indicate saved High capture priority without reordering the document.
Archive is the existing reversible removal, not deletion from the source PDF.
The Cards switch keeps all existing management controls accessible. Open editors
remain mounted when toggling the display or closing the controls.

Single-capture paragraphs now show context too. Chapter/subchapter groups and
handwritten image context are preserved. Page/column/position order replaces
creation-time ordering when source geometry is available. PDF extraction still
determines paragraph text; a truncated-context indicator is retained when supplied.

## Task actions and reviews

Facts and action shortcuts now occupy separate rows; copy/import/Q&A retain
direct access. A remaining-core-work strip excludes skipped, completed, and
optional work. Next step opens the relevant task without starting a timer.

Copy for tutor opens a reviewable prompt. Whole-note selection preserves answers
interleaved with instructions. Heading-based selection and a scratch editor let
you narrow a copy explicitly. Task rationale, resource notes/images, and prior
tutor feedback are separate options. Prior reviews are excluded only when their
structural markers are complete and balanced outside fenced code. Saved notes
are untouched. Attachment files/index are prepared after Copy using the existing
prompt-batch workflow. Import review retains its section/answer chooser, with
task-specific titles in new discussions and existing review-source Q&A entries.

The preview cannot reliably infer which unlabelled sentences are instructions
versus your own work; it intentionally leaves that choice to you. Headings such
as `## My work` make section selection faster.

## Discussions as study material

Reading mode now pairs the original question/capture with a rendered answer
excerpt across the discussion's messages. Quieter dividers replace repeated
card borders; existing pins and priority colours still anchor scanning. Compact
mode remains available. Resource/chapter entry points and Q&A order are unchanged.
Excerpts retain complete source blocks (including formulas/code) and reference
definitions. Priority preambles are omitted from excerpts; the full answer
always retains every block. Uninformative source titles such as `??` can still
appear when neither the source nor the tutor supplied a descriptive heading;
improving those titles without inventing content remains a future refinement.

Validation: 265 frontend tests, 85 affected backend tests, lint and production
build, plus isolated-database browser checks at desktop and narrow widths.
No live notes/progress or source annotations were edited for verification.
