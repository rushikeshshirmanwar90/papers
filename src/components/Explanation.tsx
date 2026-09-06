"use client";

import { useState } from "react";
import { parseExplanation } from "@shared/explanation";
import type { ExplanationChunk } from "@shared/explanation";
import { MathText } from "./MathText";

function Chunks({ chunks }: { chunks: ExplanationChunk[] }) {
  return (
    <>
      {chunks.map((chunk, i) =>
        chunk.kind === "math" ? (
          <span
            key={i}
            className="mx-1 inline-block rounded bg-white px-1.5 py-0.5 font-mono text-[0.8em] text-slate-700 ring-1 ring-slate-200"
          >
            <MathText text={chunk.value} />
          </span>
        ) : (
          <span key={i}>
            <MathText text={chunk.value} />{" "}
          </span>
        )
      )}
    </>
  );
}

export function Explanation({
  text,
  diagramUrls,
}: {
  text: string;
  diagramUrls?: string[];
}) {
  const [open, setOpen] = useState(false);
  const { answerLetter, blocks } = parseExplanation(text);
  const steps = blocks.filter((b) => b.kind === "step");

  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 bg-slate-50 px-3 py-2 text-left text-sm font-semibold text-slate-700 hover:bg-slate-100"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className={`h-4 w-4 text-slate-400 transition-transform ${open ? "rotate-90" : ""}`}
        >
          <path d="M7.5 5.5 12 10l-4.5 4.5V5.5Z" />
        </svg>
        Explanation
        {!open && steps.length > 0 && (
          <span className="font-normal text-slate-400">
            {steps.length} step{steps.length === 1 ? "" : "s"}
          </span>
        )}
        <span className="ml-auto text-xs font-medium text-indigo-600">{open ? "Hide" : "Show"}</span>
      </button>

      {open && (
        <div className="border-t border-slate-200 bg-white px-4 py-3">
          {answerLetter && (
            <div className="mb-3 inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 ring-1 ring-emerald-200">
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-bold text-white">
                {answerLetter}
              </span>
              Correct answer
            </div>
          )}

          <div className="space-y-2.5 text-sm leading-relaxed text-slate-700">
            {blocks.map((block, i) =>
              block.kind === "step" ? (
                <div key={i} className="flex gap-2.5">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-indigo-50 text-[11px] font-bold text-indigo-700">
                    {block.label}
                  </span>
                  <p className="flex-1">
                    <Chunks chunks={block.chunks} />
                  </p>
                </div>
              ) : (
                <p key={i}>
                  <Chunks chunks={block.chunks} />
                </p>
              )
            )}
          </div>

          {diagramUrls && diagramUrls.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2 border-t border-slate-100 pt-3">
              {diagramUrls.map((url) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={url}
                  src={url}
                  alt="Explanation diagram"
                  className="max-h-52 rounded border border-slate-200 bg-white"
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
