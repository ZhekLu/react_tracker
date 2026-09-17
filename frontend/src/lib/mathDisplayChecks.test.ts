// @vitest-environment jsdom
import { expect, it } from "vitest";
import { mathDisplayChecks } from "./insertDebug";

it("reports the duplicate visible math layer that round-trip checks cannot see", () => {
  const host = document.createElement("div");
  host.innerHTML = '<span class="katex"><span class="katex-mathml">x</span><span class="katex-html" aria-hidden="true">x</span></span>';
  document.body.append(host);
  try {
    expect(mathDisplayChecks(host)).toEqual(["formula accessibility layer is visible (math stylesheet missing)"]);
    (host.querySelector(".katex-mathml") as HTMLElement).style.position = "absolute";
    expect(mathDisplayChecks(host)).toEqual([]);
  } finally { host.remove(); }
});
