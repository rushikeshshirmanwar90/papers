import type { Browser } from "puppeteer-core";

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

async function printOnce(html: string, timeoutMs: number): Promise<Uint8Array> {
  const page = await (await getBrowser()).newPage();
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
    return await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      // Tagging adds an accessibility tree with a node for every bit of maths:
      // about 4.7 MB of a 6 MB, 100-question paper. Without it that's ~1.4 MB.
      tagged: false,
      outline: false,
      timeout: timeoutMs,
    });
  } finally {
    await page.close().catch(() => {});
  }
}

/**
 * One print, given up at the deadline. Puppeteer's own timeouts don't cover
 * every step (opening a page on a stuck Chrome has none), so on the deadline
 * Chrome itself is closed or killed: whatever it was doing stops.
 */
async function printBy(html: string, deadline: number): Promise<Uint8Array> {
  const left = deadline - Date.now();
  if (left <= 0) throw new RenderTimeoutError("The paper waited too long to be printed");
  const work = printOnce(html, left);
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

/**
 * Prints the page to an A4 PDF (size and margins come from its @page rule).
 * Rejects with RenderBusyError when too many papers are waiting, and with
 * RenderTimeoutError when it can't finish within timeoutMs of being asked.
 */
export function renderPdf(html: string, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<Uint8Array> {
  if (pending >= MAX_PENDING) return Promise.reject(new RenderBusyError("Too many papers are waiting to be printed"));
  pending++;
  const deadline = Date.now() + timeoutMs;
  const run = queue.then(async () => {
    try {
      return await printBy(html, deadline);
    } catch (error) {
      // A crashed or closed Chrome takes the page with it: start a fresh one
      // and try once more. Anything else is a real failure.
      if (error instanceof RenderTimeoutError) throw error;
      const current = await browser?.catch(() => null);
      if (current?.connected) throw error;
      console.warn("[question-paper-pdf] Chrome stopped, starting it again:", error);
      await dropBrowser();
      return printBy(html, deadline);
    }
  });
  const settled = run.catch(() => {}).finally(() => {
    pending--;
  });
  queue = settled;
  return run;
}
