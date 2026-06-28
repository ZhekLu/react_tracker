import { percent } from "../lib/progress";
import type { CSSProperties } from "react";

type ProgressBarProps = {
  value: number;
  label?: string;
  showValue?: boolean;
  accent?: string;
};

export function ProgressBar({ value, label, showValue = false, accent }: ProgressBarProps) {
  const normalizedValue = Math.max(0, Math.min(1, value));
  const style = {
    "--progress-value": percent(normalizedValue),
    "--progress-accent": accent,
  } as CSSProperties;

  return (
    <div
      className="progressBar"
      aria-label={label ?? "Progress"}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(normalizedValue * 100)}
      role="progressbar"
      style={style}
    >
      <div className="progressBarFill" />
      {showValue ? <span className="progressBarValue">{percent(normalizedValue)}</span> : null}
    </div>
  );
}
