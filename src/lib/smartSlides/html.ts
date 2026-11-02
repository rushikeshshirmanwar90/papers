import { escapeHtml, fontFaces, richText, type EmbeddedFigures, type PaperQuestion, type QuestionPaper } from "../questionPaper/html";
import {
  DEFAULT_SMART_SLIDE_SETTINGS,
  MIN_FONT_PX,
  optionText,
  planQuestionSlides,
  SLIDE,
  SLIDE_THEMES,
  slideGeometry,
  type OptionKey,
  type SlidePart,
} from "./layout";

// The Smart PDF as one printable HTML page: a 16:9 page per slide, the
// question at the top inside a fixed-height area, the rest of the slide left
// blank for writing. No answers, solutions or watermark. The layout comes from
// layout.ts, the same rules the app's preview uses; FIT_SLIDES_SCRIPT then
// measures each slide in Chrome and shrinks text that still doesn't fit, or
// reports it.

/** Figures as <img> tags, or a note for one that couldn't be loaded. */
function figures(urls: string[], embedded: EmbeddedFigures, className: string, maxHeight: number): string {
  return urls
    .map((url) => {
      const data = embedded.get(url);
      return data
        ? `<img class="${className}" src="${data}" alt="" style="max-height:${Math.floor(maxHeight)}px">`
        : '<p class="missing">Figure could not be loaded.</p>';
    })
    .join("");
}

function optionsHtml(q: PaperQuestion, layout: string, keys: OptionKey[], embedded: EmbeddedFigures): string {
  return `<div class="options ${layout}">${keys
    .map(
      (key) =>
        `<div class="option"><span class="mark">(${key})</span>${richText(optionText(q, key))}${figures(
          q.optionDiagramUrls[key],
          embedded,
          "opt-fig",
          SLIDE.optionFigureHeight
        )}</div>`
    )
    .join("")}</div>`;
}

export function smartSlidesHtml(paper: QuestionPaper, embedded: EmbeddedFigures): string {
  const settings = paper.slides ?? DEFAULT_SMART_SLIDE_SETTINGS;
  const g = slideGeometry(settings);
  const colors = SLIDE_THEMES[settings.theme];
  const institute = settings.showInstitute ? paper.institute.trim() : "";
  const title = paper.title.trim();

  const slide = (q: PaperQuestion, number: number, part: SlidePart, index: number, count: number, plan: ReturnType<typeof planQuestionSlides>) => {
    const label = `Q${number}${count > 1 ? ` · ${index + 1}/${count}` : ""}`;
    const figureColumn =
      part.figures && plan.figureWidth
        ? `<div class="fig" style="width:${plan.figureWidth}px">${figures(
            q.diagramUrls,
            embedded,
            "q-fig",
            (g.contentHeight - (q.diagramUrls.length - 1) * SLIDE.gap) / q.diagramUrls.length
          )}</div>`
        : "";
    return `<section class="slide" data-q="${number}" data-part="${index + 1}">
  <div class="qa">
    <div class="head"><span class="qno">${label}</span>${title ? `<span class="title">${escapeHtml(title)}</span>` : ""}${
      institute ? `<span class="inst">${escapeHtml(institute)}</span>` : ""
    }</div>
    <div class="body" style="font-size:${plan.fontPx}px">
      <div class="text">${part.stem ? `<div class="stem">${richText(part.stem)}</div>` : ""}${
        part.options && plan.mcqLayout ? optionsHtml(q, plan.mcqLayout, part.optionKeys, embedded) : ""
      }</div>${figureColumn}
    </div>
  </div>
</section>`;
  };

  const slides = paper.questions.flatMap((q, i) => {
    const plan = planQuestionSlides(q, settings);
    return plan.parts.map((part, index) => slide(q, i + 1, part, index, plan.parts.length, plan));
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${escapeHtml(paper.title)}</title>
<style>
  ${fontFaces()}
  @page { size: ${SLIDE.width}px ${SLIDE.height}px; margin: 0; }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; background: ${colors.background}; }
  body { font-family: "Noto Sans", "Noto Sans Math", sans-serif; color: ${colors.text}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  math { font-family: "Noto Sans Math", math; font-size: 1.05em; color: inherit; }
  .slide { position: relative; width: ${SLIDE.width}px; height: ${SLIDE.height}px; overflow: hidden; background: ${colors.background}; break-after: page; }
  .slide:last-child { break-after: auto; }
  /* The question area; everything below it stays blank for writing. */
  .qa { height: ${g.regionHeight}px; padding: ${SLIDE.padTop}px ${SLIDE.padX}px ${SLIDE.padBottom}px; overflow: hidden; }
  .head { display: flex; align-items: baseline; gap: 10px; height: ${SLIDE.headerHeight}px; margin-bottom: ${SLIDE.headerGap}px; font-size: ${SLIDE.headerFont}px; line-height: ${SLIDE.headerHeight}px; color: ${colors.muted}; white-space: nowrap; }
  .qno { font-weight: 700; color: ${colors.accent}; }
  .title { overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .inst { margin-left: auto; font-weight: 700; overflow: hidden; text-overflow: ellipsis; min-width: 0; max-width: 50%; }
  .body { display: flex; gap: ${SLIDE.figureGap}px; height: ${g.contentHeight}px; overflow: hidden; line-height: ${SLIDE.lineHeight}; }
  .text { flex: 1; min-width: 0; align-self: flex-start; }
  .stem { overflow-wrap: anywhere; }
  .msplit math { display: inline math; }
  .mdisp { text-align: center; }
  .mseg { display: inline-block; vertical-align: middle; }
  .options { display: grid; gap: ${SLIDE.gap}px ${SLIDE.gap * 2}px; margin-top: ${SLIDE.gap}px; }
  .options.horizontal { grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .options.grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .options.vertical { grid-template-columns: minmax(0, 1fr); }
  .option { position: relative; padding-left: ${SLIDE.markEm}em; min-width: 0; overflow-wrap: anywhere; }
  .mark { position: absolute; left: 0; top: 0; font-weight: 700; color: ${colors.accent}; }
  .fig { flex: none; display: flex; flex-direction: column; align-items: center; gap: ${SLIDE.gap}px; }
  /* Figures are dark line art: a white card keeps them visible on a board. */
  img.q-fig, img.opt-fig { display: block; max-width: 100%; width: auto; height: auto; object-fit: contain; background: #fff; border-radius: 6px; padding: 4px; }
  img.opt-fig { margin-top: 4px; }
  .missing { margin: 0; font-size: 12px; font-style: italic; color: ${colors.muted}; }
</style>
</head>
<body>
${slides.join("\n")}
</body>
</html>`;
}

/** What Chrome's measuring pass returns. */
export interface SlideFitResult {
  issues: { severity: "error" | "warning"; kind: string; where: string; detail: string }[];
  stats: { slides: number; shrunk: number };
}

/**
 * Runs in the page through page.evaluate (the page itself runs no scripts).
 * A slide whose question is taller or wider than its area has its text made
 * smaller, a pixel at a time, down to MIN_FONT_PX; one that still doesn't fit
 * is reported, never printed cut off.
 */
export const FIT_SLIDES_SCRIPT = String.raw`(() => {
  const MIN = ${MIN_FONT_PX};
  const issues = [];
  let shrunk = 0;
  const slides = Array.from(document.querySelectorAll('.slide'));
  for (const slide of slides) {
    const body = slide.querySelector('.body');
    const text = slide.querySelector('.text');
    if (!body || !text) continue;
    const over = () => text.offsetHeight > body.clientHeight + 1 || text.scrollWidth > text.clientWidth + 1;
    let size = parseFloat(getComputedStyle(body).fontSize) || 18;
    const start = size;
    while (over() && size > MIN) {
      size -= 1;
      body.style.fontSize = size + 'px';
    }
    if (size < start) shrunk++;
    if (over()) {
      const q = slide.getAttribute('data-q');
      issues.push({
        severity: 'error',
        kind: 'slide-overflow',
        where: 'Question ' + q,
        detail: 'Question ' + q + ' does not fit its slide even with smaller text.',
      });
    }
  }
  return { issues, stats: { slides: slides.length, shrunk } };
})()`;
