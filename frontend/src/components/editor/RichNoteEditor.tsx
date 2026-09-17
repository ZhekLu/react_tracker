import { DiscussionMarkdownSurface } from "./DiscussionMarkdownSurface";

type RichNoteEditorProps = {
  initialContent?: string;
  placeholder?: string;
  onChange?: (markdown: string) => void;
  onSave?: (markdown: string) => void | boolean | Promise<void | boolean>;
};

export function RichNoteEditor({initialContent = "", placeholder, onChange, onSave}: RichNoteEditorProps) {
  return <DiscussionMarkdownSurface
    editable markdown={initialContent} placeholder={placeholder}
    contentType={/^\s*<(?:p|h[1-6]|ul|ol|pre|blockquote)\b/i.test(initialContent) ? "html" : "markdown"}
    onChange={onChange} onSave={onSave} showActions={Boolean(onSave)}
  />;
}
