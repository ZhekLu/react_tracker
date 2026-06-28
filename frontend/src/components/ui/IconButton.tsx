import type { ButtonHTMLAttributes, ReactNode } from "react";

type IconButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  children: ReactNode;
  selected?: boolean;
};

export function IconButton({ label, children, className = "", selected = false, ...props }: IconButtonProps) {
  return (
    <button
      aria-label={label}
      className={`iconButton ${selected ? "selected" : ""} ${className}`.trim()}
      title={label}
      type="button"
      {...props}
    >
      {children}
    </button>
  );
}
