/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["pdfjs-dist"],
    // pdf.js runs without a real Worker in Node and instead does
    // `import("./pdf.worker.mjs")` at runtime. Output-file tracing can't
    // follow that dynamic import, so on Vercel the worker file was missing
    // from the function bundle ("Cannot find module .../pdf.worker.mjs").
    outputFileTracingIncludes: {
      "/api/papers/upload": ["./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs"],
    },
  },
};

export default nextConfig;
