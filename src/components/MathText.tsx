import { parseMathSegments } from "@shared/mathText";

export function MathText({ text }: { text: string }) {
  const segments = parseMathSegments(text);
  return (
    <>
      {segments.map((seg, i) =>
        seg.sup ? <sup key={i}>{seg.text}</sup> : <span key={i}>{seg.text}</span>
      )}
    </>
  );
}
