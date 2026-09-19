import {
  Camera,
  Check,
  Database,
  Library,
  RefreshCw,
  SlidersHorizontal,
} from "lucide-react";
import { useEffect, useState } from "react";
import {
  fetchZoteroStatus,
  type TrackerSettings,
  type ZoteroStatus,
} from "../../api/trackerApi";

type SettingsViewProps = {
  settings: TrackerSettings;
  onCaptureDebugModeChange: (enabled: boolean) => void;
};

export function SettingsView({
  settings,
  onCaptureDebugModeChange,
}: SettingsViewProps) {
  const [zotero, setZotero] = useState<ZoteroStatus | null>(null);
  const [checkingZotero, setCheckingZotero] = useState(true);

  async function refreshZotero() {
    setCheckingZotero(true);
    try {
      setZotero(await fetchZoteroStatus());
    } finally {
      setCheckingZotero(false);
    }
  }

  useEffect(() => {
    let active = true;
    void fetchZoteroStatus().then((status) => {
      if (!active) return;
      setZotero(status);
      setCheckingZotero(false);
    });
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="settingsView">
      <header className="viewToolbar">
        <div>
          <p className="eyebrow">Workspace behavior</p>
          <h2>Settings</h2>
        </div>
        <SlidersHorizontal size={22} />
      </header>

      <section className="settingsCard">
        <div className="settingsCardIcon"><Camera size={20} /></div>
        <div className="settingsCardCopy">
          <h3>Capture debug mode</h3>
          <p>
            Preview every new question screenshot before import. You can move
            and resize the proposed crop; the reviewed region is then rendered
            and logged for improving future automatic selection.
          </p>
          <span className="settingsEvidence">
            <Database size={13} /> {settings.captureCorrectionCount} reviewed
            region{settings.captureCorrectionCount === 1 ? "" : "s"} logged
          </span>
        </div>
        <button
          aria-pressed={settings.captureDebugMode}
          className={`settingsToggle ${settings.captureDebugMode ? "active" : ""}`}
          onClick={() => onCaptureDebugModeChange(!settings.captureDebugMode)}
          type="button"
        >
          <span>{settings.captureDebugMode ? <Check size={13} /> : null}</span>
          {settings.captureDebugMode ? "On" : "Off"}
        </button>
      </section>

      <section className="settingsCard">
        <div className="settingsCardIcon"><Library size={20} /></div>
        <div className="settingsCardCopy">
          <h3>Zotero local library</h3>
          <p>
            Finished papers are sent only when you approve their saved resource
            note. Bibliographic metadata comes from the original paper page;
            Tracker adds that note, resource tags, and the local PDF.
          </p>
          <span className={`settingsEvidence ${zotero?.enabled ? "connected" : ""}`}>
            <Database size={13} />
            {zotero?.message ?? "Checking local Zotero…"}
            {zotero?.itemCount != null ? ` · ${zotero.itemCount} library items` : ""}
          </span>
          {!zotero?.enabled ? (
            <small className="settingsHelp">
              Keep Zotero open and enable “Allow other applications on this
              computer to communicate with Zotero” in Settings → Advanced.
              Choose “Always Allow” on the first export to avoid repeated prompts.
            </small>
          ) : null}
        </div>
        <button
          className="settingsSecondaryButton"
          disabled={checkingZotero}
          onClick={() => void refreshZotero()}
          type="button"
        >
          <RefreshCw className={checkingZotero ? "spinning" : ""} size={14} />
          Check connection
        </button>
      </section>
    </div>
  );
}
