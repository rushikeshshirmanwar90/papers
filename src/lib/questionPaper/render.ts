import type { Browser } from "puppeteer-core";
import { checkPdf, FIT_SCRIPT, PRINT_VIEWPORT_WIDTH_PX, type FitResult, type LayoutReport } from "./layoutFit";
import { fitSlidesScript, type SlideFitResult } from "../smartSlides/html";
import { SLIDE, type SmartSlideSettings } from "../smartSlides/layout";

// HTML to PDF with headless Chrome: @sparticuz/chromium's build on Linux
// (Vercel), a local Chrome elsewhere (CHROME_PATH, else the usual install path).
//
// On Vercel, Chrome runs with --single-process. In that mode
// browser.createBrowserContext() crashes Chrome ("Target.createTarget: Target
// closed"), so each paper gets a plain browser.newPage(), one at a time.

const LOCAL_CHROME: Record<string, string> = {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
};

// The page is served from this made-up address so it can be answered from
// memory; every other request the page makes is refused.
const PAGE_URL = "https://question-paper.invalid/";

/** How long a paper may take, waiting in line included, unless the caller gives a limit. */
const DEFAULT_TIMEOUT_MS = 80000;
/** Papers waiting for (or being) printed on this server; more are turned away. */
const MAX_PENDING = 4;
/** How long Chrome gets to close before it is killed. */
const CLOSE_TIMEOUT_MS = 5000;

/** The paper wasn't printed in time. Chrome was restarted, so nothing is left running. */
export class RenderTimeoutError extends Error {}
/** Too many papers are already waiting on this server. */
export class RenderBusyError extends Error {}

async function launchBrowser(): Promise<Browser> {
  const { default: puppeteer } = await import("puppeteer-core");
  const localChrome = process.env.CHROME_PATH ?? LOCAL_CHROME[process.platform];
  if (localChrome) return puppeteer.launch({ executablePath: localChrome, headless: true });

  // Linux without CHROME_PATH: the serverless build, set up as its README shows.
  const { default: chromium } = await import("@sparticuz/chromium");
  // No WebGL needed for print; skips setting up SwiftShader.
  chromium.setGraphicsMode = false;
  return puppeteer.launch({
    args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
    executablePath: await chromium.executablePath(),
    headless: "shell",
  });
}

let launcher: () => Promise<Browser> = launchBrowser;

/** Tests only: start a stand-in browser instead of Chrome (null restores Chrome). */
export async function setBrowserLauncherForTests(next: (() => Promise<Browser>) | null) {
  await dropBrowser();
  launcher = next ?? launchBrowser;
}

// One browser per server instance, reused while it stays warm.
let browser: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser) {
    const current = await browser.catch(() => null);
    if (current?.connected) return current;
  }
  browser = launcher();
  browser.catch(() => {
    browser = null;
  });
  return browser;
}

/** Closes the shared browser (killing it if it won't close) so the next paper starts a fresh one. */
async function dropBrowser() {
  const current = browser;
  browser = null;
  const instance = await current?.catch(() => null);
  if (!instance) return;
  const closed = await Promise.race([
    instance.close().then(() => true, () => false),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), CLOSE_TIMEOUT_MS)),
  ]);
  if (!closed) instance.process()?.kill("SIGKILL");
}

/** Where a print's time went, in ms. */
export interface RenderTimings {
  /** Waiting in line behind other papers on this server. */
  queue: number;
  /** Opening a page, starting Chrome first when it wasn't running. */
  page: number;
  /** Loading the HTML. */
  load: number;
  /** The measuring pass, fonts and figures included. */
  measure: number;
  /** Printing the PDF (0 when it wasn't printed). */
  pdf: number;
}

/** The paper printed (null when the measuring pass said not to), and what that pass found (null when it didn't run). */
interface Printed<R = FitResult> {
  pdf: Uint8Array | null;
  fit: R | null;
  ms: RenderTimings;
}

/** A measuring pass: the script Chrome evaluates, at the size the page prints at. */
interface FitPass<R = unknown> {
  script: string;
  width: number;
  height: number;
  /** Whether to print after measuring; nothing is printed when this says no. */
  print?: (fit: R) => boolean;
}

const PAPER_FIT: FitPass<FitResult> = { script: FIT_SCRIPT, width: PRINT_VIEWPORT_WIDTH_PX, height: 1200 };

async function printOnce<R>(html: string, timeoutMs: number, fit: FitPass<R> | null): Promise<Printed<R>> {
  let mark = Date.now();
  const lap = () => {
    const now = Date.now();
    const spent = now - mark;
    mark = now;
    return spent;
  };
  const ms: RenderTimings = { queue: 0, page: 0, load: 0, measure: 0, pdf: 0 };
  const page = await (await getBrowser()).newPage();
  ms.page = lap();
  try {
    await page.setJavaScriptEnabled(false);
    await page.setRequestInterception(true);
    page.on("request", (request) => {
      if (request.url() === PAGE_URL) {
        void request.respond({ status: 200, contentType: "text/html; charset=utf-8", body: html });
      } else {
        void request.abort();
      }
    });
    await page.goto(PAGE_URL, { waitUntil: "load", timeout: Math.min(60000, timeoutMs) });
    ms.load = lap();
    let fitted: R | null = null;
    if (fit) {
      // Measure at the width the paper prints at. The page runs no scripts of
      // its own (JavaScript is off); this is Chrome's own evaluation.
      await page.emulateMediaType("print");
      await page.setViewport({ width: fit.width, height: fit.height });
      fitted = (await page.evaluate(fit.script)) as R;
      ms.measure = lap();
      if (fit.print && !fit.print(fitted)) return { pdf: null, fit: fitted, ms };
    }
    const pdf = await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      // Tagging adds an accessibility tree with a node for every bit of maths:
      // about 4.7 MB of a 6 MB, 100-question paper. Without it that's ~1.4 MB.
      tagged: false,
      outline: false,
      timeout: timeoutMs,
    });
    ms.pdf = lap();
    return { pdf, fit: fitted, ms };
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * One print, given up at the deadline. Puppeteer's own timeouts don't cover
 * every step (opening a page on a stuck Chrome has none), so on the deadline
 * Chrome itself is closed or killed: whatever it was doing stops.
 */
async function printBy<R>(html: string, deadline: number, fit: FitPass<R> | null): Promise<Printed<R>> {
  const left = deadline - Date.now();
  if (left <= 0) throw new RenderTimeoutError("The paper waited too long to be printed");
  const work = printOnce<R>(html, left, fit);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new RenderTimeoutError(`Printing took over ${left} ms`)), left);
  });
  try {
    return await Promise.race([work, timeout]);
  } catch (error) {
    if (error instanceof RenderTimeoutError) {
      work.catch(() => {});
      await dropBrowser();
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

// Papers print one at a time: Vercel can send one instance several requests
// at once, and a single-process Chrome is safest with one page open.
let queue: Promise<unknown> = Promise.resolve();
let pending = 0;

function enqueue<R = FitResult>(html: string, timeoutMs: number, fit: FitPass<R> | null): Promise<Printed<R>> {
  if (pending >= MAX_PENDING) return Promise.reject(new RenderBusyError("Too many papers are waiting to be printed"));
  pending++;
  const asked = Date.now();
  const deadline = asked + timeoutMs;
  const run = queue.then(async () => {
    const waited = Date.now() - asked;
    try {
      const printed = await printBy<R>(html, deadline, fit);
      printed.ms.queue = waited;
      return printed;
    } catch (error) {
      // A crashed or closed Chrome takes the page with it: start a fresh one
      // and try once more. Anything else is a real failure.
      if (error instanceof RenderTimeoutError) throw error;
      const current = await browser?.catch(() => null);
      if (current?.connected) throw error;
      console.warn("[question-paper-pdf] Chrome stopped, starting it again:", error);
      await dropBrowser();
      const printed = await printBy<R>(html, deadline, fit);
      printed.ms.queue = waited;
      return printed;
    }
  });
  const settled = run.catch(() => {}).finally(() => {
    pending--;
  });
  queue = settled;
  return run;
}

/**
 * Prints the page to an A4 PDF (size and margins come from its @page rule).
 * Rejects with RenderBusyError when too many papers are waiting, and with
 * RenderTimeoutError when it can't finish within timeoutMs of being asked.
 */
export async function renderPdf(html: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Uint8Array> {
  return (await enqueue(html, timeoutMs, null)).pdf!;
}

/**
 * Prints a question paper like renderPdf, after Chrome has measured it at its
 * printed width and fixed what doesn't fit (layoutFit.ts), then checks the PDF
 * itself. The report lists what is still wrong; `questions` is how many
 * numbered questions the PDF must show; `watermark` is the text printed
 * across every page, which the check must not take for paper content.
 */
export async function renderPaper(
  html: string,
  questions: number,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  watermark = ""
): Promise<{ pdf: Uint8Array; layout: LayoutReport }> {
  const printed = await enqueue(html, timeoutMs, PAPER_FIT);
  const fit = printed.fit;
  const pdf = printed.pdf!;
  const issues = [...(fit?.issues ?? [])];
  let pages = 0;
  try {
    const checked = await checkPdf(pdf, { questions, figures: fit?.stats.rasterFigures ?? 0, watermark });
    issues.push(...checked.issues);
    pages = checked.pages;
  } catch (error) {
    // The paper is printed; only the final check couldn't run.
    console.warn("[question-paper-pdf] layout check failed:", error);
    issues.push({ severity: "warning", kind: "check-failed", where: "Paper", detail: "The finished PDF could not be checked." });
  }
  const stats = fit?.stats ?? { equations: 0, equationsScaled: 0, optionsStacked: 0, figures: 0, rasterFigures: 0, keysResized: 0 };
  return { pdf, layout: { issues, stats: { ...stats, pages } } };
}

const unmeasured = (): SlideFitResult => ({
  issues: [{ severity: "error", kind: "check-failed", where: "Slides", detail: "The slides could not be measured." }],
  stats: { slides: 0, questions: 0, short: 0, medium: 0, full: 0, blank: 0, shrunk: 0, equationsScaled: 0, readyMs: 0, layoutMs: 0 },
  plan: [],
});

/**
 * Prints a Smart PDF (one 16:9 page per slide). Chrome first measures every
 * question in the page itself and sizes its slide (smartSlides/html.ts); the
 * PDF is printed from that same page, so it is exactly what was measured.
 * When the measuring pass finds an error nothing is printed: pdf is null and
 * fit says why, without the cost of a PDF that would be thrown away.
 * `print: false` only measures (tests).
 */
export async function renderSlides(
  html: string,
  settings: SmartSlideSettings,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  opts: { print?: boolean } = {}
): Promise<{ pdf: Uint8Array | null; fit: SlideFitResult; ms: RenderTimings }> {
  const { pdf, fit, ms } = await enqueue<SlideFitResult>(html, timeoutMs, {
    script: fitSlidesScript(settings),
    width: SLIDE.width,
    height: SLIDE.height,
    print: (result) => opts.print !== false && !!result && !result.issues.some((issue) => issue.severity === "error"),
  });
  return { pdf, fit: fit ?? unmeasured(), ms };
}
