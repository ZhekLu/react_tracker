import type { CSSProperties } from "react";

type CompletionBurstProps = {
  token: number;
  variant?: "task" | "day";
};

const particleCount = {
  task: 7,
  day: 16,
} as const;

export function CompletionBurst({ token, variant = "task" }: CompletionBurstProps) {
  if (!token) return null;

  return (
    <span aria-hidden="true" className={`completionBurst ${variant}`} key={token}>
      {Array.from({ length: particleCount[variant] }, (_, index) => (
        <span className="completionParticle" key={index} style={{ "--particle-index": index } as CSSProperties} />
      ))}
    </span>
  );
}
