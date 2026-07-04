import { ArrowLeft, Copy, Play, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { PetCelebration } from "../../components/rewards/PetCelebration";
import {
  petAnimationDescriptions,
  petAnimationModes,
  petAssetUrl,
  petCelebrationConfig,
  type PetAnimationMode,
  type PetCelebrationVariant,
} from "../../config/petCelebrations";

function displayName(asset: string): string {
  return asset
    .replace(/\.[^.]+$/, "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function PetAnimationLab() {
  const [asset, setAsset] = useState(petCelebrationConfig.assets[0] ?? "");
  const [mode, setMode] = useState<PetAnimationMode>(
    petCelebrationConfig.day.animation,
  );
  const [variant, setVariant] = useState<PetCelebrationVariant>("day");
  const [copies, setCopies] = useState(petCelebrationConfig.day.copies);
  const [durationMs, setDurationMs] = useState(
    petCelebrationConfig.day.duration_ms,
  );
  const [sizePx, setSizePx] = useState(petCelebrationConfig.day.size_px);
  const [token, setToken] = useState(1);
  const configPreview = useMemo(
    () =>
      JSON.stringify(
        {
          animation: mode,
          copies,
          duration_ms: durationMs,
          size_px: sizePx,
        },
        null,
        2,
      ),
    [copies, durationMs, mode, sizePx],
  );

  function preview(
    nextAsset = asset,
    nextMode = mode,
    nextVariant = variant,
  ) {
    setAsset(nextAsset);
    setMode(nextMode);
    setVariant(nextVariant);
    setToken((current) => current + 1);
  }

  function applyPreset(nextVariant: PetCelebrationVariant) {
    const preset = petCelebrationConfig[nextVariant];
    setVariant(nextVariant);
    setMode(preset.animation);
    setCopies(preset.copies);
    setDurationMs(preset.duration_ms);
    setSizePx(preset.size_px);
    setToken((current) => current + 1);
  }

  async function copyConfig() {
    await navigator.clipboard.writeText(configPreview);
  }

  return (
    <main className="petLabPage">
      <header className="petLabHeader">
        <a className="petLabBack" href="/">
          <ArrowLeft size={16} />
          Tracker
        </a>
        <div>
          <p className="eyebrow">Reward workshop</p>
          <h1>Pet animation laboratory</h1>
          <p>
            Pick a GIF, tune the motion, then copy the winning preset into
            <code>pet_animations.json</code>.
          </p>
        </div>
        <Sparkles aria-hidden="true" size={34} />
      </header>

      <section className="petLabWorkbench">
        <div className="petLabControls">
          <div className="petLabPresetButtons">
            <button onClick={() => applyPreset("task")} type="button">
              Task preset
            </button>
            <button onClick={() => applyPreset("day")} type="button">
              Day preset
            </button>
          </div>

          <fieldset>
            <legend>Animation</legend>
            <div className="petModeGrid">
              {petAnimationModes.map((item) => (
                <button
                  className={item === mode ? "active" : ""}
                  key={item}
                  onClick={() => preview(asset, item)}
                  type="button"
                >
                  <strong>{item}</strong>
                  <span>{petAnimationDescriptions[item]}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset>
            <legend>GIF</legend>
            <div className="petAssetGrid">
              {petCelebrationConfig.assets.map((item) => (
                <button
                  className={item === asset ? "active" : ""}
                  key={item}
                  onClick={() => preview(item)}
                  type="button"
                >
                  <img alt="" src={petAssetUrl(item)} />
                  <span>{displayName(item)}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="petLabSliders">
            <label>
              <span>Copies <b>{copies}</b></span>
              <input
                max="20"
                min="1"
                onChange={(event) => setCopies(Number(event.target.value))}
                type="range"
                value={copies}
              />
            </label>
            <label>
              <span>Size <b>{sizePx}px</b></span>
              <input
                max="160"
                min="28"
                onChange={(event) => setSizePx(Number(event.target.value))}
                type="range"
                value={sizePx}
              />
            </label>
            <label>
              <span>Duration <b>{(durationMs / 1000).toFixed(1)}s</b></span>
              <input
                max="5000"
                min="600"
                onChange={(event) => setDurationMs(Number(event.target.value))}
                step="100"
                type="range"
                value={durationMs}
              />
            </label>
          </div>
        </div>

        <div className="petLabPreviewColumn">
          <section className="petLabStage">
            <div className="petLabStageLabel">
              <span>{variant} · {mode}</span>
              <button onClick={() => preview()} type="button">
                <Play size={14} />
                Replay
              </button>
            </div>
            <PetCelebration
              asset={asset}
              contained
              copies={copies}
              durationMs={durationMs}
              message={variant === "day" ? "PERFECT DAY!" : undefined}
              mode={mode}
              sizePx={sizePx}
              token={token}
              variant={variant}
            />
          </section>

          <section className="petConfigPreview">
            <header>
              <div>
                <p className="eyebrow">Selected preset</p>
                <h2>{displayName(asset)}</h2>
              </div>
              <button onClick={() => void copyConfig()} type="button">
                <Copy size={14} />
                Copy JSON
              </button>
            </header>
            <pre><code>{configPreview}</code></pre>
          </section>
        </div>
      </section>

      <section className="petCombinationMatrix">
        <header>
          <p className="eyebrow">Combination matrix</p>
          <h2>Every GIF × every motion</h2>
          <p>Click any cell to send that combination to the stage.</p>
        </header>
        <div className="petCombinationGrid">
          {petCelebrationConfig.assets.flatMap((item) =>
            petAnimationModes.map((animation) => (
              <button
                key={`${item}-${animation}`}
                onClick={() => preview(item, animation)}
                title={`${displayName(item)} · ${animation}`}
                type="button"
              >
                <img alt="" src={petAssetUrl(item)} />
                <span>{animation}</span>
              </button>
            )),
          )}
        </div>
      </section>
    </main>
  );
}
