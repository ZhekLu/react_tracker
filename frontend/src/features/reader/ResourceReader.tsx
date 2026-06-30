import {
  BookOpen,
  CheckCircle2,
  CircleHelp,
  Highlighter,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  fetchResourceContent,
  type ResourceContentResult,
} from "../../api/trackerApi";
import { ProgressBar } from "../../components/ProgressBar";
import { CompletionBurst } from "../../components/rewards/CompletionBurst";
import { useCompletionReward } from "../../hooks/useCompletionReward";
import type { AnnotationKind, Resource } from "../../types/tracker";

type ResourceReaderProps = {
  accent: string;
  resource: Resource;
  onClose: (progressPercent: number) => void;
  onCreateAnnotation: (
    kind: AnnotationKind,
    quote: string,
    sectionTitle?: string,
  ) => void;
  onOpenExternal: () => void;
};

type SelectionState = {
  quote: string;
  sectionTitle?: string;
};

function markdownBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let paragraph: string[] = [];
  let code: string[] | null = null;
  let codeLanguage = "";

  function flushParagraph() {
    if (!paragraph.length) return;
    nodes.push(<p key={`p-${nodes.length}`}>{paragraph.join(" ")}</p>);
    paragraph = [];
  }

  function flushCode() {
    if (code === null) return;
    nodes.push(
      <pre key={`code-${nodes.length}`} data-language={codeLanguage}>
        <code>{code.join("\n")}</code>
      </pre>,
    );
    code = null;
    codeLanguage = "";
  }

  for (const line of lines) {
    const fence = line.match(/^```(.*)$/);
    if (fence) {
      if (code === null) {
        flushParagraph();
        code = [];
        codeLanguage = fence[1].trim();
      } else {
        flushCode();
      }
      continue;
    }
    if (code !== null) {
      code.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      const level = heading[1].length;
      if (level === 1) nodes.push(<h1 key={`h-${nodes.length}`}>{heading[2]}</h1>);
      if (level === 2) nodes.push(<h2 key={`h-${nodes.length}`}>{heading[2]}</h2>);
      if (level === 3) nodes.push(<h3 key={`h-${nodes.length}`}>{heading[2]}</h3>);
      if (level === 4) nodes.push(<h4 key={`h-${nodes.length}`}>{heading[2]}</h4>);
      continue;
    }
    const bullet = line.match(/^\s*[-*]\s+(?:\[[ xX]\]\s+)?(.+)$/);
    if (bullet) {
      flushParagraph();
      nodes.push(<div className="readerBullet" key={`li-${nodes.length}`}>• {bullet[1]}</div>);
      continue;
    }
    const numbered = line.match(/^\s*(\d+)\.\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      nodes.push(
        <div className="readerBullet" key={`li-${nodes.length}`}>
          {numbered[1]}. {numbered[2]}
        </div>,
      );
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      nodes.push(<blockquote key={`q-${nodes.length}`}>{quote[1]}</blockquote>);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      continue;
    }
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushCode();
  return nodes;
}

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
  resource,
  onClose,
  onCreateAnnotation,
  onOpenExternal,
}: ResourceReaderProps) {
  const [content, setContent] = useState<ResourceContentResult | null>(null);
  const [error, setError] = useState("");
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [progressPercent, setProgressPercent] = useState(
    Math.round(resource.progress * 100),
  );
  const reward = useCompletionReward();
  const scrollRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetchResourceContent(resource.id)
      .then((result) => {
        if (!cancelled) setContent(result);
      })
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
  }, [resource.id]);

  const renderedMarkdown = useMemo(
    () => (content?.format === "markdown" ? markdownBlocks(content.content) : null),
    [content],
  );

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
    const element = scrollRef.current;
    if (!element) return;
    const available = element.scrollHeight - element.clientHeight;
    const ratio = available <= 0 ? 1 : element.scrollTop / available;
    setProgressPercent(Math.max(progressPercent, Math.min(99, Math.round(ratio * 100))));
  }

  function close() {
    onClose(progressPercent);
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
        role="dialog"
        style={{ "--course-accent": accent } as CSSProperties}
      >
        <CompletionBurst token={reward.token} variant="day" />
        <header className="readerHeader">
          <div>
            <p className="eyebrow">In-app reader</p>
            <h2>{resource.title}</h2>
            <span>{content?.sourcePath ?? resource.version?.fileName ?? "Loading source…"}</span>
          </div>
          <div className="readerHeaderActions">
            <button onClick={onOpenExternal} title="Open with the system application" type="button">
              <BookOpen size={16} />
            </button>
            <button onClick={close} title="Close reader" type="button">
              <X size={17} />
            </button>
          </div>
          <div className="readerPinnedProgress">
            <ProgressBar
              accent={accent}
              label="Reading progress"
              showValue
              value={progressPercent / 100}
            />
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
          className="readerScroll"
          onMouseUp={() => captureSelection(window.getSelection())}
          onScroll={updateProgress}
          ref={scrollRef}
        >
          {error ? <div className="inlineError">{error}</div> : null}
          {!content && !error ? <div className="editorLoading">Loading reader…</div> : null}
          {content?.format === "markdown" ? (
            <article className="readerDocument">{renderedMarkdown}</article>
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

        <footer className="readerFooter">
          <span>Select text to save a highlight or question with source context.</span>
          <button
            className="commandButton"
            onClick={() => {
              reward.celebrate(900);
              setProgressPercent(100);
              window.setTimeout(() => onClose(100), 520);
            }}
            type="button"
          >
            <CheckCircle2 size={15} />
            <span>Finish resource</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
