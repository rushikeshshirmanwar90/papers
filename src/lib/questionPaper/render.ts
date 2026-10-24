import type { Browser } from "puppeteer-core";

// HTML to PDF with headless Chrome: @sparticuz/chromium's build on Vercel, a
// local Chrome in development (CHROME_PATH, else the usual install path).

const LOCAL_CHROME: Record<string, string> = {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "/usr/bin/google-chrome",
  win32: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
};

// The page is served from this made-up address so it can be answered from
// memory; every other request the page makes is refused.
const PAGE_URL = "https://question-paper.invalid/";

async function launchBrowser(): Promise<Browser> {
  const { default: puppeteer } = await import("puppeteer-core");
  if (process.env.VERCEL) {
    const { default: chromium } = await import("@sparticuz/chromium");
    // No WebGL needed for print; skips unpacking SwiftShader on a cold start.
    chromium.setGraphicsMode = false;
    return puppeteer.launch({ args: chromium.args, executablePath: await chromium.executablePath(), headless: true });
  }
  const executablePath = process.env.CHROME_PATH ?? LOCAL_CHROME[process.platform];
  if (!executablePath) throw new Error("Set CHROME_PATH to a Chrome or Chromium executable to make PDFs locally.");
  return puppeteer.launch({ executablePath, headless: true });
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

/** Prints the page to an A4 PDF (size and margins come from its @page rule). */
export async function renderPdf(html: string): Promise<Uint8Array> {
  const context = await (await getBrowser()).createBrowserContext();
  try {
    const page = await context.newPage();
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
    await context.close().catch(() => {});
  }
}
