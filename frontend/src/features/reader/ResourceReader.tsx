import {
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Highlighter,
  ListTodo,
  MessageSquarePlus,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import {
  fetchResourceContent,
  fetchPdfReaderMetadata,
  pdfReaderPageUrl,
  type PdfReaderMetadata,
  type ResourceContentResult,
} from "../../api/trackerApi";
import { StudyPassProgress } from "../../components/StudyPassProgress";
import { MarkdownMath } from "../../components/content/MarkdownMath";
import { CompletionBurst } from "../../components/rewards/CompletionBurst";
import { useCompletionReward } from "../../hooks/useCompletionReward";
import type { AnnotationKind, Resource } from "../../types/tracker";
import { prepareReaderCapture } from "../../lib/readerCapture";

type ResourceReaderProps = {
  accent: string;
  resource: Resource;
  onClose: (progressPercent: number) => void;
  initialPage?: number;
  onPageChange?: (pageNumber: number) => void;
  onCreateAnnotation: (
    kind: AnnotationKind,
    quote: string,
    sectionTitle?: string,
  ) => void;
  onCreatePageAnnotation: (
    kind: "note" | "question" | "todo",
    markdown: string,
    pageNumber: number,
    sectionTitle?: string,
    includeScreenshot?: boolean,
  ) => void;
  onOpenExternal: () => void;
};

type SelectionState = {
  quote: string;
  sectionTitle?: string;
};

function sectionFromSelection(selection: Selection | null): string | undefined {
  const node = selection?.anchorNode;
  const element =
    node?.nodeType === Node.ELEMENT_NODE
      ? (node as Element)
      : node?.parentElement;
  const heading = element?.closest(
    ".readerDocument h1, .readerDocument h2, .readerDocument h3, .readerDocument h4",
  );
  return heading?.textContent?.trim() || undefined;
}

export function ResourceReader({
  accent,
  initialPage = 1,
  resource,
  onClose,
  onCreateAnnotation,
  onCreatePageAnnotation,
  onOpenExternal,
  onPageChange,
}: ResourceReaderProps) {
  const [content, setContent] = useState<ResourceContentResult | null>(null);
  const [pdf, setPdf] = useState<PdfReaderMetadata | null>(null);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [progressPercent, setProgressPercent] = useState(
    Math.round(resource.progress * 100),
  );
  const [passNumber, setPassNumber] = useState(1);
  const [passPages, setPassPages] = useState<Set<number>>(() => new Set());
  const [passPercent, setPassPercent] = useState(0);
  const [loadedPage, setLoadedPage] = useState(0);
  const [pageNumber, setPageNumber] = useState(Math.max(1, initialPage));
  const [quickDraft, setQuickDraft] = useState<string | null>(null);
  const [quickKind, setQuickKind] = useState<"note" | "question" | "todo">(
    "note",
  );
  const reward = useCompletionReward();
  const scrollRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const readerRef = useRef<HTMLElement>(null);
  const quickInputRef = useRef<HTMLTextAreaElement>(null);
  const quickEditorOpen = quickDraft !== null;

  useLayoutEffect(() => {
    if (!quickEditorOpen) return;
    const input = quickInputRef.current;
    if (!input) return;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }, [quickEditorOpen]);
  const localPath =
    resource.version?.localPath ??
    resource.localFiles.find((file) => file.isPrimary)?.localPath ??
    resource.localFiles[0]?.localPath ??
    "";
  const isPdf = localPath.toLowerCase().endsWith(".pdf");

  useEffect(() => {
    let cancelled = false;
    const request = isPdf
      ? fetchPdfReaderMetadata(resource.id).then((result) => {
          if (!cancelled) {
            setPdf(result);
            const boundedPage = Math.min(
              result.pageCount,
              Math.max(1, initialPage),
            );
            setPageNumber(boundedPage);
            setProgressPercent((current) =>
              Math.max(
                current,
                Math.round((boundedPage / result.pageCount) * 100),
              ),
            );
          }
        })
      : fetchResourceContent(resource.id).then((result) => {
          if (!cancelled) setContent(result);
        });
    request
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(
            caught instanceof Error ? caught.message : "Could not load resource.",
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [initialPage, isPdf, resource.id]);

  useEffect(() => {
    readerRef.current?.focus();
  }, [pdf]);

  function captureSelection(selectionValue: Selection | null) {
    const quote = selectionValue?.toString().replace(/\s+/g, " ").trim() ?? "";
    setSelection(
      quote.length >= 2
        ? {
            quote: quote.slice(0, 4_000),
            sectionTitle: sectionFromSelection(selectionValue),
          }
        : null,
    );
  }

  function updateProgress() {
    if (pdf) return;
    const element = scrollRef.current;
    if (!element) return;
    const available = element.scrollHeight - element.clientHeight;
    const ratio = available <= 0 ? 1 : element.scrollTop / available;
    const percent = Math.round(ratio * 100);
    setPassPercent(current => Math.max(current, percent));
    setProgressPercent(current => Math.max(current, Math.min(99, percent)));
  }

  useEffect(() => {
    if (!pdf || loadedPage !== pageNumber) return;
    const timer = window.setTimeout(() => setPassPages(current => new Set([...current, pageNumber])), 700);
    return () => window.clearTimeout(timer);
  }, [pdf, loadedPage, pageNumber, passNumber]);

  function restartPass() {
    setPassNumber(number => number + 1);
    setPassPages(new Set());
    setPassPercent(0);
    if (pdf) goToPage(1);
    else scrollRef.current?.scrollTo({top: 0});
  }

  function close() {
    onClose(progressPercent);
  }

  function goToPage(nextPage: number) {
    if (!pdf) return;
    const bounded = Math.min(pdf.pageCount, Math.max(1, nextPage));
    if (bounded === pageNumber) return;
    setPageNumber(bounded);
    setProgressPercent((current) =>
      Math.max(current, Math.round((bounded / pdf.pageCount) * 100)),
    );
    onPageChange?.(bounded);
  }

  function saveQuickAnnotation() {
    const prepared = prepareReaderCapture(quickDraft ?? "", quickKind);
    const { includeScreenshot, markdown } = prepared;
    if (!markdown) return;
    onCreatePageAnnotation(
      prepared.kind,
      markdown,
      pageNumber,
      pdf?.pages[pageNumber - 1]?.title,
      includeScreenshot,
    );
    setQuickDraft(null);
    setQuickKind("note");
    window.setTimeout(() => readerRef.current?.focus(), 0);
  }

  function handleReaderKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!pdf) return;
    const target = event.target as HTMLElement;
    if (target.matches("textarea, input, select, [contenteditable='true']")) {
      return;
    }
    if (event.key === "ArrowRight" || event.key === "PageDown") {
      event.preventDefault();
      goToPage(pageNumber + 1);
      return;
    }
    if (event.key === "ArrowLeft" || event.key === "PageUp") {
      event.preventDefault();
      goToPage(pageNumber - 1);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      goToPage(1);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      goToPage(pdf.pageCount);
      return;
    }
    if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      if (event.key === "?") {
        setQuickKind("question");
        setQuickDraft("/screen ");
      } else if (event.key === "!") {
        setQuickKind("todo");
        setQuickDraft("/screen ");
      } else {
        setQuickKind("note");
        setQuickDraft(`/screen ${event.key}`);
      }
    }
  }

  function createSelectionAnnotation(kind: AnnotationKind) {
    if (!selection) return;
    onCreateAnnotation(kind, selection.quote, selection.sectionTitle);
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    iframeRef.current?.contentWindow?.getSelection()?.removeAllRanges();
  }

  function bindIframeSelection() {
    const frameDocument = iframeRef.current?.contentDocument;
    const frameWindow = iframeRef.current?.contentWindow;
    if (!frameDocument || !frameWindow) return;
    frameDocument.addEventListener("mouseup", () => {
      captureSelection(frameWindow.getSelection());
    });
    frameWindow.addEventListener("scroll", () => {
      const available =
        frameDocument.documentElement.scrollHeight - frameWindow.innerHeight;
      const ratio = available <= 0 ? 1 : frameWindow.scrollY / available;
      setPassPercent(current => Math.max(current, Math.round(ratio * 100)));
      setProgressPercent((current) =>
        Math.max(current, Math.min(99, Math.round(ratio * 100))),
      );
    });
  }

  return (
    <div className="readerBackdrop" role="presentation">
      <section
        aria-label={`Reader: ${resource.title}`}
        className="resourceReader"
        onKeyDown={handleReaderKeyDown}
        ref={readerRef}
        role="dialog"
        style={{ "--course-accent": accent } as CSSProperties}
        tabIndex={-1}
      >
        <CompletionBurst token={reward.token} variant="day" />
        <header className="readerHeader">
          <div>
            <p className="eyebrow">In-app reader</p>
            <h2>{resource.title}</h2>
            <span>
              {pdf?.sourcePath ??
                content?.sourcePath ??
                resource.version?.fileName ??
                "Loading source…"}
            </span>
            {pdf ? (
              <small>
                Slide {pageNumber} / {pdf.pageCount}
                {pdf.pages[pageNumber - 1]?.title
                  ? ` · ${pdf.pages[pageNumber - 1].title}`
                  : ""}
              </small>
            ) : null}
          </div>
          <div className="readerHeaderActions">
            <button onClick={onOpenExternal} title="Open with the system application" type="button">
              <BookOpen size={16} />
            </button>
            <button aria-label="Close reader" onClick={close} title="Close reader" type="button">
              <X size={17} />
            </button>
          </div>
          <div className="readerPinnedProgress">
            <StudyPassProgress
              label={`Reading pass ${passNumber}`}
              done={pdf ? passPages.size : passPercent}
              total={pdf ? pdf.pageCount : 100}
              onRestart={restartPass} restartDisabled={quickDraft !== null}
              detail={pdf
                ? passPages.size === pdf.pageCount ? "Every slide revisited. Pass complete." : `${pdf.pageCount - passPages.size} slides left · each visited slide counts once`
                : passPercent >= 100 ? "Reading pass complete." : "Fresh progress for this reading pass"}
            />
            <div className="readerPassHistory">Saved reading progress: {progressPercent}%</div>
          </div>
        </header>

        {selection ? (
          <aside className="selectionCapture">
            <blockquote>{selection.quote}</blockquote>
            <div>
              <button onClick={() => createSelectionAnnotation("highlight")} type="button">
                <Highlighter size={14} /> Save highlight
              </button>
              <button onClick={() => createSelectionAnnotation("question")} type="button">
                <CircleHelp size={14} /> Save question
              </button>
            </div>
          </aside>
        ) : null}

        <div
          className={pdf ? "readerScroll pdfReaderScroll" : "readerScroll"}
          onMouseUp={() => captureSelection(window.getSelection())}
          onScroll={updateProgress}
          ref={scrollRef}
        >
          {error ? <div className="inlineError">{error}</div> : null}
          {!content && !pdf && !error ? <div className="editorLoading">Loading reader…</div> : null}
          {pdf ? (
            <div className="pdfSlideStage">
              <button
                aria-label="Previous slide"
                disabled={pageNumber <= 1}
                onClick={() => goToPage(pageNumber - 1)}
                title="Previous slide · Left arrow"
                type="button"
              >
                <ChevronLeft size={22} />
              </button>
              <img
                alt={`Slide ${pageNumber}: ${
                  pdf.pages[pageNumber - 1]?.title ?? resource.title
                }`}
                onLoad={() => setLoadedPage(pageNumber)}
                src={pdfReaderPageUrl(resource.id, pageNumber)}
              />
              <button
                aria-label="Next slide"
                disabled={pageNumber >= pdf.pageCount}
                onClick={() => goToPage(pageNumber + 1)}
                title="Next slide · Right arrow"
                type="button"
              >
                <ChevronRight size={22} />
              </button>
            </div>
          ) : null}
          {content?.format === "markdown" ? (
            <MarkdownMath className="readerDocument">
              {content.content}
            </MarkdownMath>
          ) : null}
          {content?.format === "text" ? (
            <pre className="readerDocument readerPlainText">{content.content}</pre>
          ) : null}
          {content?.format === "html" ? (
            <iframe
              onLoad={bindIframeSelection}
              ref={iframeRef}
              sandbox=""
              srcDoc={content.content}
              title={resource.title}
            />
          ) : null}
        </div>

        {pdf && quickDraft !== null ? (
          <aside className={`pdfQuickNote kind-${quickKind}`}>
            <header>
              <span>
                {quickKind === "question" ? (
                  <CircleHelp size={14} />
                ) : quickKind === "todo" ? (
                  <ListTodo size={14} />
                ) : (
                  <MessageSquarePlus size={14} />
                )}
                Slide {pageNumber} note
              </span>
              <button
                aria-label="Cancel quick note"
                onClick={() => {
                  setQuickDraft(null);
                  window.setTimeout(() => readerRef.current?.focus(), 0);
                }}
                type="button"
              >
                <X size={13} />
              </button>
            </header>
            <div className="pdfQuickNoteKinds">
              {(["note", "question", "todo"] as const).map((kind) => (
                <button
                  className={quickKind === kind ? "active" : ""}
                  key={kind}
                  onClick={() => setQuickKind(kind)}
                  type="button"
                >
                  {kind}
                </button>
              ))}
            </div>
            <textarea
              aria-label="Slide note"
              ref={quickInputRef}
              onChange={(event) => setQuickDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setQuickDraft(null);
                  window.setTimeout(() => readerRef.current?.focus(), 0);
                }
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                  event.preventDefault();
                  saveQuickAnnotation();
                }
              }}
              placeholder="Type your thought. /screen attaches this slide; remove it for text only."
              value={quickDraft}
            />
            <button
              className="commandButton"
              disabled={!prepareReaderCapture(quickDraft, quickKind).markdown}
              onClick={saveQuickAnnotation}
              type="button"
            >
              Save to slide {pageNumber}
            </button>
          </aside>
        ) : null}

        <footer className="readerFooter">
          <span>
            {pdf
              ? "←/→ slides · type note · ? question · ! todo · /screen attach · ⌘Enter save"
              : "Select text to save a highlight or question with source context."}
          </span>
          <button
            className="commandButton"
            onClick={() => {
              reward.celebrate(900);
              setProgressPercent(100);
              setPassPercent(100);
              if (pdf) setPassPages(new Set(pdf.pages.map((_, index) => index + 1)));
              window.setTimeout(() => onClose(100), 520);
            }}
            type="button"
          >
            <CheckCircle2 size={15} />
            <span>{resource.progress >= 1 ? "Finish pass" : "Finish resource"}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
