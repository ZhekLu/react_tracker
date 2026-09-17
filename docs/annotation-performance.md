# Annotation and interaction performance

Measured locally on September 10–11, 2026, using the TORL workspace and a copy of
its database. Collection benchmarks replayed one complete Drawboard download so
network variability did not distort local comparisons. Live study progress was
not changed by the benchmarks.

| Work | Before | After |
| --- | --- | --- |
| Repeat local collection, existing preview files | 35.4 s | 3.7–4.3 s |
| Local collection with cold PDF text cache, existing preview files | — | 12.1–13.6 s |
| Workspace answer-reference parsing | 65–88 ms | 59 ms cold; 7–10 ms warm |
| Unchanged imported rows on repeat | One frame rewritten every time | Zero writes; 766 existing rows |

The 9.52 MB workspace response took about 201 ms locally before browser JSON,
answer parsing, and React rendering. Every status change previously waited for
that full refresh. Chapters, tasks, and days now update immediately and save in
per-entity revision queues without downloading the workspace again. Resource
and exam status changes update immediately and refresh dependent data in the
background. Rapid double-clicks were verified against a temporary database:
unread → partial → full produced two saved revisions.

The local collection profile found 1,535 sorted PDF text extractions, responsible
for roughly 94% of processing time. Sorted page text and PDF structure now use
bounded caches keyed by resolved file path, nanosecond mtime, size, and page.
No live PyMuPDF handles are cached. Frontend Markdown normalization also has a
bounded cache, and each discussion is parsed once when deriving answer links.

Only open question previews are considered for rendering. Snapshot filenames
include source PDF version, renderer settings, and the visible annotation data.
Unchanged regions reuse their PNGs; off-region edits do not invalidate a crop.
Writes are atomic and historical files are retained. A reconciled larger frame
keeps its full-page preview until the page changes instead of alternating between
the smaller source crop and the reconciled frame on every collection.

## Remaining cost and consistency boundaries

The measured Drawboard download took 133 seconds for 698 text captures and 26,270
ink strokes over approximately 60 sequential batches. The API supplies the next
page cursor in each response. Connections are now pooled, and confirming the
color palette reuses the downloaded extraction for up to ten minutes. A complete
post-change cloud download has not been timed, so the local speedup must not be
presented as an end-to-end cloud speedup. The server did not compress the measured
responses despite compression negotiation.

Ordinary collections still fetch fresh source presence, which is necessary for
reliable deletion detection. Incomplete batches abort before database
reconciliation. Collections are serialized to prevent an older download from
overwriting a newer one. SQLite retains WAL mode; ordinary status operations do
not acquire the collection lock. Long cloud collection requests still occupy a
worker, and a future background job/incremental API would improve that boundary.

Source removal is a soft deletion of every imported kind, including questions.
Question identities and answer history remain stable. Recoloring never demotes
a question; answered/archived image references remain frozen. Legacy screenshot
files remain as last saved: a screenshot already overwritten by an older tracker
version cannot be reconstructed retroactively.

Validation includes backend integration tests for deletion, recoloring, legacy
PDF identity upgrades, frozen image bytes, regional cache invalidation, palette
reuse, malformed batches, and unchanged frame idempotency; frontend tests cover
revision queues, derived progress, and saved snapshot selection. The September 17
integration check also resolved the 12 pre-existing mypy errors: explicit handling
at untyped PyMuPDF calls, one duplicate local annotation, and a fixed-length crop
tuple. The full backend type check now passes.
