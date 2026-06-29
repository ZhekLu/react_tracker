import { ProgressBar } from "./ProgressBar";

type MetricBarProps = {
  accent: string;
  label: string;
  value: number;
  total: number;
};

export function MetricBar({ accent, label, value, total }: MetricBarProps) {
  const ratio = total > 0 ? value / total : 0;

  return (
    <div className="metricBar">
      <div className="metricBarLabel">
        <span>{label}</span>
        <strong>{value}/{total}</strong>
      </div>
      <ProgressBar accent={accent} value={ratio} />
    </div>
  );
}
