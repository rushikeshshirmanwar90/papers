/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Headless Chrome for question-paper PDFs is loaded at runtime, not bundled.
    serverComponentsExternalPackages: ["pdfjs-dist", "puppeteer-core", "@sparticuz/chromium"],
    // pdf.js runs without a real Worker in Node and instead does
    // `import("./pdf.worker.mjs")` at runtime. Output-file tracing can't
    // follow that dynamic import, so on Vercel the worker file was missing
    // from the function bundle ("Cannot find module .../pdf.worker.mjs").
    outputFileTracingIncludes: {
      "/api/papers/upload": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
      // The Chrome build is unpacked from these at runtime, and the fonts are
      // read from disk into each paper; tracing sees neither.
      "/api/question-paper-pdf": [
        "./node_modules/@sparticuz/chromium/bin/**",
        "./node_modules/@fontsource/noto-sans/files/noto-sans-{latin,latin-ext,greek}-{400-normal,400-italic,700-normal}.woff2",
        "./node_modules/@fontsource/noto-sans-math/files/noto-sans-math-latin-400-normal.woff2",
      ],
    },
  },
};

export default nextConfig;
