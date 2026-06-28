import type { CSSProperties } from "react";
import { percent } from "../../lib/progress";

type ProgressRingProps = {
  value: number;
  label: string;
  size?: "small" | "medium";
  accent?: string;
};

export function ProgressRing({ value, label, size = "medium", accent }: ProgressRingProps) {
  const normalizedValue = Math.max(0, Math.min(1, value));
  const style = {
    "--ring-value": `${normalizedValue * 360}deg`,
    "--ring-accent": accent,
  } as CSSProperties;

  return (
    <div
      className={`progressRing ${size}`}
      aria-label={`${label}: ${percent(normalizedValue)}`}
      role="img"
      style={style}
    >
      <span>{Math.round(normalizedValue * 100)}</span>
    </div>
  );
}
