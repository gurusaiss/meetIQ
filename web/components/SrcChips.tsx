export function SrcChips({ refs }: { refs: string[] }) {
  return (
    <span className="srcs" title="Transcript segments this statement is derived from">
      {refs.map((r) => (
        <span className="src" key={r}>{r}</span>
      ))}
    </span>
  );
}
