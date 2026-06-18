import { percent } from "../lib/progress";

type ProgressBarProps = {
  value: number;
  label?: string;
};

export function ProgressBar({ value, label }: ProgressBarProps) {
  return (
    <div className="progressBar" aria-label={label ?? "Progress"}>
      <div className="progressBarFill" style={{ width: percent(value) }} />
    </div>
  );
}
