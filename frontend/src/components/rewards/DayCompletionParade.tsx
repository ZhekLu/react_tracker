type DayCompletionParadeProps = {
  complete: boolean;
  token: number;
};

const animals = ["🐈", "🐕", "🐈‍⬛", "🐕‍🦺", "🐈", "🐩", "🐕", "🐈‍⬛"];

export function DayCompletionParade({
  complete,
  token,
}: DayCompletionParadeProps) {
  if (!complete || !token) return null;
  return (
    <div
      aria-label="Perfect day complete. The study pets have arrived."
      className="dayCompletionParade"
      key={token}
      role="status"
    >
      <strong>PERFECT DAY!</strong>
      {animals.map((animal, index) => (
        <span
          className={`paradeAnimal animal-${index + 1}`}
          key={`${animal}-${index}`}
        >
          {animal}
        </span>
      ))}
    </div>
  );
}
