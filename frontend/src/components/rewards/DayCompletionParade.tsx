import { PetCelebration } from "./PetCelebration";

type DayCompletionParadeProps = {
  complete: boolean;
  token: number;
};

export function DayCompletionParade({
  complete,
  token,
}: DayCompletionParadeProps) {
  if (!complete || !token) return null;
  return (
    <PetCelebration
      announce="Perfect day complete. The study pets have arrived."
      message="PERFECT DAY!"
      token={token}
      variant="day"
    />
  );
}
