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

// One browser per server instance, reused while it stays warm.
let browser: Promise<Browser> | null = null;

async function getBrowser(): Promise<Browser> {
  if (browser) {
    const current = await browser.catch(() => null);
    if (current?.connected) return current;
  }
  browser = launchBrowser();
  browser.catch(() => {
    browser = null;
  });
  return browser;
}

/** Closes the shared browser so the next paper starts a fresh one. */
async function dropBrowser() {
  const current = browser;
  browser = null;
  const instance = await current?.catch(() => null);
  await instance?.close().catch(() => {});
}

async function printOnce(html: string): Promise<Uint8Array> {
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
    await page.goto(PAGE_URL, { waitUntil: "load", timeout: 60000 });
    return await page.pdf({
      preferCSSPageSize: true,
      printBackground: true,
      // Tagging adds an accessibility tree with a node for every bit of maths:
      // about 4.7 MB of a 6 MB, 100-question paper. Without it that's ~1.4 MB.
      tagged: false,
      outline: false,
      timeout: 120000,
    });
  } finally {
    await page.close().catch(() => {});
  }
}

// Papers print one at a time: Vercel can send one instance several requests
// at once, and a single-process Chrome is safest with one page open.
let queue: Promise<unknown> = Promise.resolve();

/** Prints the page to an A4 PDF (size and margins come from its @page rule). */
export function renderPdf(html: string): Promise<Uint8Array> {
  const run = queue.then(async () => {
    try {
      return await printOnce(html);
    } catch (error) {
      // A crashed or closed Chrome takes the page with it: start a fresh one
      // and try once more. Anything else is a real failure.
      const current = await browser?.catch(() => null);
      if (current?.connected) throw error;
      console.warn("[question-paper-pdf] Chrome stopped, starting it again:", error);
      await dropBrowser();
      return printOnce(html);
    }
  });
  queue = run.catch(() => {});
  return run;
}