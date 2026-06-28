import { useCallback, useEffect, useRef, useState } from "react";

type CompletionReward = {
  active: boolean;
  celebrate: (duration?: number) => void;
  token: number;
};

export function useCompletionReward(): CompletionReward {
  const [token, setToken] = useState(0);
  const [active, setActive] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const celebrate = useCallback((duration = 900) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setToken(Date.now());
    setActive(true);
    timeoutRef.current = setTimeout(() => {
      setActive(false);
      setToken(0);
      timeoutRef.current = null;
    }, duration);
  }, []);

  useEffect(
    () => () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    [],
  );

  return { active, celebrate, token };
}
