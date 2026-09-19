# Zotero integration

The tracker remains the working library. Zotero receives a paper only after the
paper has been read and its final per-resource note has been explicitly approved.

## Export contract

- The resource must have kind `paper`, status `read` or `review`, an original
  source URL, a readable local PDF, and a non-empty `resource` note.
- The first export fetches bibliographic metadata from the original source. arXiv
  links use the arXiv Atom API; other sources must expose standard `citation_*`
  metadata. Tracker title/authors are not used as a silent fallback. A source
  that cannot provide title and authors is rejected before Zotero is changed.
- Tracker contributes the approved resource note, its existing resource tags,
  and the local PDF file. The parent, note, and attachment are created together,
  then the PDF is uploaded with Zotero's full-file protocol.
- Later approvals update only the tracker-owned note, add tracker tags without
  deleting Zotero tags, and replace the attachment when the local PDF hash
  changes. Bibliographic fields edited in Zotero are left alone.
- Zotero object IDs, hashes, source URL, local server ID, and partial failures are
  recorded in `resource_integration_exports`, preventing duplicate first exports.
  An export recorded for another Zotero library is blocked rather than copied
  silently into the wrong library.

## Local setup and authorization

Zotero 10 or newer must be open with Settings → Advanced → “Allow other
applications on this computer to communicate with Zotero” enabled. Settings in
the tracker shows a read-only connection check and current local item count.

On the first write Zotero shows an authorization dialog for “Study Tracker”.
Choosing “Always Allow” avoids prompts for the item and file-upload phases. The
local API key is held only in process memory; it is never stored in the tracker
database or logs. A one-time authorization is reacquired as required by Zotero.

The app must retain filesystem permission to the PDF. For iCloud papers, start
the tracker from the already-authorized terminal session.

## Known limits

- There is no bulk/background export: approval is per paper, from the paper's
  resource row or its task-level paper-note panel.
- The official local Web API does not expose Zotero Connector's browser
  translator workflow. The tracker therefore reads source-provided citation
  metadata and writes that metadata through Zotero's supported local API.
- Pages without arXiv metadata or `citation_*` tags need their original-source
  page fixed/mapped before export. DOI-only lookup and unlink/recreate UI are not
  implemented yet.
