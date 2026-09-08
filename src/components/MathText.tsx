import { parseMathNodes, type AccentType, type MathNode, type MathSegment } from "@shared/mathText";

// Glyph drawn above the base letter for each accent type — see the CSS in
// globals.css (.math-accent) for how it's positioned. Matches the printed
// paper's notation: P⃗ for vectors, î/ĵ/k̂ for unit vectors.
const ACCENT_GLYPH: Record<AccentType, string> = {
  vector: "→",
  hat: "^",
  tilde: "~",
  acute: "´",
  grave: "`",
};

function PlainSegments({ segments }: { segments: MathSegment[] }) {
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.accent) {
          return (
            <span key={i} className="math-accent" data-accent={seg.accent} data-glyph={ACCENT_GLYPH[seg.accent]}>
              {seg.text}
            </span>
          );
        }
        return seg.sup ? <sup key={i}>{seg.text}</sup> : <span key={i}>{seg.text}</span>;
      })}
    </>
  );
}

function MathNodeView({ node }: { node: MathNode }) {
  if (node.kind === "plain") return <PlainSegments segments={node.segments} />;

  if (node.kind === "root") {
    return (
      <span className="math-root">
        <span className="math-root-sign">√</span>
        <span className="math-root-radicand">
          {node.radicand.map((n, i) => (
            <MathNodeView key={i} node={n} />
          ))}
        </span>
      </span>
    );
  }

  return (
    <span className="math-frac">
      <span className="math-frac-num">
        {node.num.map((n, i) => (
          <MathNodeView key={i} node={n} />
        ))}
      </span>
      <span className="math-frac-den">
        {node.den.map((n, i) => (
          <MathNodeView key={i} node={n} />
        ))}
      </span>
    </span>
  );
}

export function MathText({ text }: { text: string }) {
  const nodes = parseMathNodes(text);
  return (
    <>
      {nodes.map((n, i) => (
        <MathNodeView key={i} node={n} />
      ))}
    </>
  );
}
