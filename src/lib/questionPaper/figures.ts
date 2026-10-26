import { openFile } from "@/lib/storage";

// Figures go into the page as data URIs, so Chrome loads nothing over the
// network while printing (the page's own requests are all blocked; see
// render.ts). Only known hosts are fetched from, so the endpoint can't be
// pointed at arbitrary or internal URLs.

const FIGURE_TIMEOUT_MS = 10000;
const PARALLEL_DOWNLOADS = 16;
const MAX_FIGURE_BYTES = 5 * 1024 * 1024;
const STORED_FILE = /^\/api\/files\/([a-f0-9]{24})$/i;

// Figures loaded by earlier papers on this (warm) server, by URL, oldest
// first. Figure URLs aren't reused for different images, so they stay valid.
const CACHE_LIMIT_CHARS = 64 * 1024 * 1024;
const cache = new Map<string, string>();
let cachedChars = 0;

function remember(url: string, dataUri: string) {
  cache.set(url, dataUri);
  cachedChars += dataUri.length;
  for (const [oldest, data] of cache) {
    if (cachedChars <= CACHE_LIMIT_CHARS) break;
    cache.delete(oldest);
    cachedChars -= data.length;
  }
}

/** Hosts figures may be downloaded from: PDF_FIGURE_HOSTS, comma-separated, or the question bank's CDN. */
function figureHosts(): Set<string> {
  const list = process.env.PDF_FIGURE_HOSTS ?? "vedclass-cdn.s3.ap-south-1.amazonaws.com";
  return new Set(
    list
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter(Boolean)
  );
}

/** One figure as a data URI, or null when it isn't allowed or can't be loaded in time. */
async function loadFigure(url: string, ownHost: string, hosts: Set<string>): Promise<string | null> {
  let parsed: URL;
  try {
    parsed = new URL(url, `https://${ownHost}`);
  } catch {
    return null;
  }
  const host = parsed.host.toLowerCase();

  // A diagram this backend stored (/api/files/<id>) is read from the database.
  const storedId = parsed.pathname.match(STORED_FILE)?.[1];
  if (storedId && (host === ownHost || hosts.has(host))) {
    const file = await openFile(storedId);
    return file?.contentType.startsWith("image/") ? `data:${file.contentType};base64,${file.data.toString("base64")}` : null;
  }

  if (parsed.protocol !== "https:" || !hosts.has(host)) return null;
  const res = await fetch(parsed, { signal: AbortSignal.timeout(FIGURE_TIMEOUT_MS), redirect: "error" });
  if (!res.ok) return null;
  const type = res.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
  if (!type.startsWith("image/")) return null;
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length === 0 || bytes.length > MAX_FIGURE_BYTES) return null;
  return `data:${type};base64,${bytes.toString("base64")}`;
}

/**
 * Loads the figures, many at a time; one that fails becomes a "could not be
 * loaded" note. No new download starts after `budgetMs` (one under way still
 * has its own timeout), so slow figure hosts can't hold the paper up for long.
 */
export async function embedFigures(urls: string[], ownHost: string, budgetMs = Infinity): Promise<Map<string, string | null>> {
  const stopAt = Date.now() + budgetMs;
  const hosts = figureHosts();
  const embedded = new Map<string, string | null>();
  const toLoad = urls.filter((url) => {
    const known = cache.get(url);
    if (known) embedded.set(url, known);
    return !known;
  });
  let next = 0;
  const worker = async () => {
    while (next < toLoad.length) {
      const url = toLoad[next++];
      if (Date.now() >= stopAt) {
        embedded.set(url, null);
        continue;
      }
      const dataUri = await loadFigure(url, ownHost.toLowerCase(), hosts).catch(() => null);
      if (dataUri) remember(url, dataUri);
      embedded.set(url, dataUri);
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_DOWNLOADS, toLoad.length) }, worker));
  return embedded;
}
