import { useId, useRef, useState } from "react";
import { MessageSquareText, Star, X } from "lucide-react";
import type { ComponentProps } from "react";
import { CompactAnnotationCard } from "./CompactAnnotationCard";
import { ParagraphHighlights } from "./ParagraphHighlights";
import { annotationDisplayText, annotationIsScreenshot, annotationParagraphPageRange, annotationParagraphText, metadataBoolean, metadataText } from "./annotationDisplay";
import { MarkdownMath } from "../content/MarkdownMath";
import type { Annotation } from "../../types/tracker";

type Props = Omit<ComponentProps<typeof CompactAnnotationCard>, "annotation"> & { annotations: Annotation[] };

export function AnnotationReadingGroup({annotations, onAnnotationChange, onDiscuss, onNoteSave}: Props) {
  const [open, setOpen] = useState(false);
  const [visited, setVisited] = useState(false);
  const [selection, setSelection] = useState<string[]>([]);
  const returnFocus = useRef<HTMLElement | null>(null);
  const id = useId();
  const first = annotations[0];
  const paragraph = annotations.map(annotationParagraphText).sort((a, b) => b.length - a.length)[0];
  const range = annotationParagraphPageRange(first);
  const page = range.start ?? first.anchor?.pageNumber;
  const pageLabel = page ? range.end && range.end !== page ? `pp. ${page}–${range.end}` : `p. ${page}` : "";
  const images = [...new Set(annotations.map(a => metadataText(a, "contextImageUrl")).filter(Boolean))];
  const screenshotsOnly = annotations.every(annotationIsScreenshot);
  const important = annotations.some(a => a.priority === "high");
  const notes = annotations.filter(a => a.notes.length || a.kind === "note").length;

  function reveal(ids: string[] = []) {
    returnFocus.current = document.activeElement as HTMLElement;
    setSelection(ids); setVisited(true); setOpen(true);
  }
  function close() { setOpen(false); returnFocus.current?.focus(); }

  return <article className={`annotationReadingGroup ${important ? "isImportant" : ""}`}>
    <div className="annotationReadingMargin">
      {pageLabel ? <span>{pageLabel}</span> : null}
      {important ? <Star size={12} aria-label="Important"/> : null}
      {notes ? <span title={`${notes} capture${notes === 1 ? " has" : "s have"} notes`}><MessageSquareText size={11}/></span> : null}
      <button aria-controls={id} aria-expanded={open} onClick={() => open ? close() : reveal()} title="Notes and capture controls" type="button">
        {annotations.length} {annotations.length === 1 ? "capture" : "captures"}
      </button>
    </div>
    <div className="annotationReadingText">
      {images.length ? <div className="paragraphCaptureImages">{images.map(src => <img key={src} src={src} alt={`Captured context${pageLabel ? ` · ${pageLabel}` : ""}`}/>)}</div> : null}
      {paragraph && !screenshotsOnly ? <p>
        <ParagraphHighlights paragraph={paragraph} annotations={annotations} onSelect={reveal}/>
        {metadataBoolean(first, "contextParagraphTruncated") ? <small> … context shortened</small> : null}
      </p> : !screenshotsOnly || !images.length ? <MarkdownMath>{first.body?.markdown || annotationDisplayText(first)}</MarkdownMath> : null}
      <div className="annotationReadingControls" hidden={!open} id={id} onKeyDown={event => {
        if (event.key === "Escape" && event.target === event.currentTarget) close();
      }} tabIndex={-1}>
        {visited ? <>
          <header><span>Capture notes & controls</span><div>
            {selection.length ? <button onClick={() => setSelection([])} type="button">Show all {annotations.length}</button> : null}
            <button aria-label="Close capture controls" onClick={close} type="button"><X size={14}/></button>
          </div></header>
          {annotations.map(annotation => <div hidden={selection.length > 0 && !selection.includes(annotation.id)} key={annotation.id}>
            <CompactAnnotationCard annotation={annotation} onAnnotationChange={onAnnotationChange}
              onDiscuss={onDiscuss} onNoteSave={onNoteSave} showExtendedContext={false}/>
          </div>)}
        </> : null}
      </div>
    </div>
  </article>;
}
