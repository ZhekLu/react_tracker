import rawConfig from "../../../pet_animations.json";

export const petAnimationModes = [
  "scamper",
  "parade",
  "orbit",
  "bounce",
  "firework",
] as const;

export type PetAnimationMode = (typeof petAnimationModes)[number];
export type PetCelebrationVariant = "task" | "day";

export type PetCelebrationPreset = {
  animation: PetAnimationMode;
  copies: number;
  duration_ms: number;
  size_px: number;
};

type PetCelebrationConfig = {
  assets: string[];
  day: PetCelebrationPreset;
  enabled: boolean;
  respect_reduced_motion: boolean;
  task: PetCelebrationPreset;
};

export const petCelebrationConfig = rawConfig as PetCelebrationConfig;

export function petAssetUrl(asset: string): string {
  return `/${encodeURIComponent(asset)}`;
}

export function petCelebrationDuration(
  variant: PetCelebrationVariant,
): number {
  return petCelebrationConfig[variant].duration_ms;
}

export const petAnimationDescriptions: Record<PetAnimationMode, string> = {
  bounce: "Pops into several positions with a compact celebratory bounce.",
  firework: "Explodes copies from the centre like soft, ridiculous fireworks.",
  orbit: "Loops pets around the celebration centre before fading away.",
  parade: "Sends a small group across the available width at different heights.",
  scamper: "Runs one or more pets across the bottom edge of the target.",
};
