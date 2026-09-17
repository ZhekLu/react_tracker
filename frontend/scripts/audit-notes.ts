// Read-only scanner. Input/output live outside git; it never writes study data.
import {readFileSync, writeFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {JSDOM} from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>");
for (const name of ["window", "document", "navigator", "HTMLElement", "Element", "Node", "DOMParser", "MutationObserver", "getComputedStyle"]) {
  Object.defineProperty(globalThis, name, {value: (dom.window as unknown as Record<string, unknown>)[name], configurable: true});
}
dom.window.document.elementFromPoint = () => null;
const {inspectEditorMarkdown, createIntegrityEditor} = await import("../src/lib/editorIntegrity");
const {repairHistoricalMarkdown} = await import("../src/lib/repairHistoricalMarkdown");
const rows = JSON.parse(readFileSync(process.argv[2], "utf8")) as {id: string; markdown: string; revision: number; original_sha256?: string; manual_reasons?: string[]; note_id: string | null; message_id: string | null}[];
const output = [];
for (const [index, row] of rows.entries()) {
  if (process.env.AUDIT_VERBOSE) process.stderr.write(`${index} ${row.id}\n`);
  const source = row.markdown ?? "";
  try {
    const repair = repairHistoricalMarkdown(source);
    const result = inspectEditorMarkdown(repair.markdown);
    let comparison;
    if (result.checks.length) {
      const before = createIntegrityEditor(repair.markdown), after = createIntegrityEditor(result.serialized);
      comparison = {before: before.getJSON(), after: after.getJSON()};
      before.destroy(); after.destroy();
    }
    const repairedEditor = createIntegrityEditor(repair.markdown);
    const plain_text = repairedEditor.state.doc.textBetween(0, repairedEditor.state.doc.content.size, "\n", leaf =>
      ["inlineMath", "blockMath"].includes(leaf.type.name) ? `$${String(leaf.attrs.latex ?? "")}$` : "");
    repairedEditor.destroy();
    output.push({...row, ...repair, ...result, comparison, plain_text,
      original_sha256: row.original_sha256 ?? createHash("sha256").update(source).digest("hex"),
      reasons: [...(row.manual_reasons ?? []), ...repair.reasons]});
  } catch (error) {output.push({...row, checks: [String(error)], reasons: []});}
  if (index % 100 === 0) process.stderr.write(`Audited ${index}/${rows.length}\n`);
}
writeFileSync(process.argv[3], JSON.stringify(output));
const counts: Record<string, number> = {};
for (const row of output) for (const check of row.checks) counts[check] = (counts[check] ?? 0) + 1;
process.stdout.write(JSON.stringify({documents: rows.length, repairs: output.filter(r => r.reasons.length).length, checks: counts}, null, 2) + "\n");
