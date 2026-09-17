import {inspectEditorMarkdown} from "./editorIntegrity";

self.onmessage = (event: MessageEvent<string>) => {
  try {self.postMessage(inspectEditorMarkdown(event.data));}
  catch {self.postMessage({serialized: "", reopened: "", checks: ["editor parse failed"]});}
};
