import { lazy, Suspense, useState } from "react";
import { FilePenLine, Save } from "lucide-react";
import type { Note } from "../../types/tracker";

const RichNoteEditor = lazy(() =>
  import("../editor/RichNoteEditor").then((module) => ({
    default: module.RichNoteEditor,
  })),
);

type EntityNoteEditorProps = {
  label?: string;
  note?: Note;
  placeholder: string;
  onSave: (html: string) => void;
};

function noteContent(note?: Note): string {
  return note?.document.markdown ?? note?.document.plainText ?? "";
}

export function EntityNoteEditor({
  label = "Notes",
  note,
  placeholder,
  onSave,
}: EntityNoteEditorProps) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(noteContent(note));
  const [savedContent, setSavedContent] = useState(noteContent(note));

  function save() {
    onSave(draft);
    setSavedContent(draft);
  }

  return (
    <details className="entityNoteEditor" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <FilePenLine size={14} />
        <span>{label}</span>
        {savedContent.trim() ? <span className="notePresent">saved</span> : null}
      </summary>
      {open ? (
        <div className="entityNoteEditorBody">
          <Suspense fallback={<div className="editorLoading">Loading editor...</div>}>
            <RichNoteEditor
              initialContent={draft}
              onChange={setDraft}
              placeholder={placeholder}
            />
          </Suspense>
          <div className="noteActions">
            <button
              className="commandButton"
              disabled={draft === savedContent}
              onClick={save}
              type="button"
            >
              <Save size={14} />
              <span>Save</span>
            </button>
          </div>
        </div>
      ) : null}
    </details>
  );
}
