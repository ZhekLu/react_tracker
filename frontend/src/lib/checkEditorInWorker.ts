export type EditorCheckResult = {serialized: string; reopened: string; checks: string[]};

/** A malformed response must never stall the actual editor or the review UI. */
export function checkEditorInWorker(markdown: string): Promise<EditorCheckResult> {
  return new Promise(resolve => {
    const worker = new Worker(new URL("./editorIntegrity.worker.ts", import.meta.url), {type: "module"});
    const timeout = window.setTimeout(() => finish({serialized: "", reopened: "", checks: ["parser exceeded the 8-second check limit"]}), 8000);
    function finish(result: EditorCheckResult) {window.clearTimeout(timeout); worker.terminate(); resolve(result);}
    worker.onmessage = (event: MessageEvent<EditorCheckResult>) => finish(event.data);
    worker.onerror = () => finish({serialized: "", reopened: "", checks: ["editor check could not run"]});
    worker.postMessage(markdown);
  });
}
