import { useMemo, type CSSProperties } from "react";
import {
  petAssetUrl,
  petCelebrationConfig,
  type PetAnimationMode,
  type PetCelebrationVariant,
} from "../../config/petCelebrations";

type PetCelebrationProps = {
  announce?: string;
  asset?: string;
  contained?: boolean;
  copies?: number;
  durationMs?: number;
  message?: string;
  mode?: PetAnimationMode;
  sizePx?: number;
  token: number;
  variant: PetCelebrationVariant;
};

type PetActorStyle = CSSProperties & {
  "--pet-angle": string;
  "--pet-angle-end": string;
  "--pet-delay": string;
  "--pet-dx": string;
  "--pet-dy": string;
  "--pet-radius": string;
  "--pet-size": string;
  "--pet-x": string;
  "--pet-y": string;
};

function seededUnit(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function actorStyle(
  token: number,
  index: number,
  sizePx: number,
): PetActorStyle {
  const seed = token % 100_003;
  const x = 7 + seededUnit(seed + index * 17) * 86;
  const y = 6 + seededUnit(seed + index * 29) * 78;
  const dx = (seededUnit(seed + index * 41) - 0.5) * 84;
  const dy = (seededUnit(seed + index * 53) - 0.5) * 74;
  const angle = Math.round(seededUnit(seed + index * 67) * 360);
  return {
    "--pet-angle": `${angle}deg`,
    "--pet-angle-end": `${angle + 360}deg`,
    "--pet-delay": `${Math.round(index * 55 + seededUnit(seed + index) * 90)}ms`,
    "--pet-dx": `${dx.toFixed(2)}vw`,
    "--pet-dy": `${dy.toFixed(2)}vh`,
    "--pet-radius": `${38 + seededUnit(seed + index * 71) * 54}px`,
    "--pet-size": `${Math.max(24, sizePx * (0.8 + seededUnit(seed + index * 83) * 0.4))}px`,
    "--pet-x": `${x.toFixed(2)}%`,
    "--pet-y": `${y.toFixed(2)}%`,
  };
}

export function PetCelebration({
  announce,
  asset,
  contained = false,
  copies,
  durationMs,
  message,
  mode,
  sizePx,
  token,
  variant,
}: PetCelebrationProps) {
  const preset = petCelebrationConfig[variant];
  const selectedAsset = useMemo(() => {
    if (asset) return asset;
    const assets = petCelebrationConfig.assets;
    return assets[Math.abs(token) % assets.length] ?? "";
  }, [asset, token]);

  if (!petCelebrationConfig.enabled || !token || !selectedAsset) return null;

  const selectedMode = mode ?? preset.animation;
  const selectedCopies = Math.max(1, Math.min(24, copies ?? preset.copies));
  const selectedDuration = Math.max(
    450,
    Math.min(6_000, durationMs ?? preset.duration_ms),
  );
  const selectedSize = Math.max(24, Math.min(180, sizePx ?? preset.size_px));
  const className = [
    "petCelebration",
    `petCelebration-${variant}`,
    `petAnimation-${selectedMode}`,
    petCelebrationConfig.respect_reduced_motion ? "respectReducedMotion" : "",
    contained ? "isContained" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <span
      aria-hidden={announce ? undefined : "true"}
      aria-label={announce}
      className={className}
      key={`${token}-${selectedAsset}-${selectedMode}`}
      role={announce ? "status" : undefined}
      style={{ "--pet-duration": `${selectedDuration}ms` } as CSSProperties}
    >
      {message ? <strong className="petCelebrationMessage">{message}</strong> : null}
      {Array.from({ length: selectedCopies }, (_, index) => (
        <img
          alt=""
          className="petActor"
          draggable={false}
          key={`${selectedAsset}-${index}`}
          src={petAssetUrl(selectedAsset)}
          style={actorStyle(token, index, selectedSize)}
        />
      ))}
    </span>
  );
}
