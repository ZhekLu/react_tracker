import { useState } from "react";
import { InsertDebugView } from "./InsertDebugView";
import { UsageDebugView } from "./UsageDebugView";
import { NotePlayground } from "./NotePlayground";
export function DebugView({courseId}: {courseId: string}) {
  const [tab, setTab] = useState("inserts");
  return <><nav className="discussionViewModes" aria-label="Debug views"><button className="commandButton subtle" aria-pressed={tab === "inserts"} onClick={() => setTab("inserts")}>Editor inserts</button><button className="commandButton subtle" aria-pressed={tab === "playground"} onClick={() => setTab("playground")}>Note playground</button><button className="commandButton subtle" aria-pressed={tab === "usage"} onClick={() => setTab("usage")}>Usage & friction</button></nav>
    {tab === "inserts" ? <InsertDebugView courseId={courseId}/> : tab === "playground" ? <NotePlayground/> : <UsageDebugView courseId={courseId}/>}</>;
}
