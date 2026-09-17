// Single entry point for loading pdf.js on the server.
//
// pdf.js's Node build evaluates `new DOMMatrix()` while the module loads and
// expects to borrow DOMMatrix from the optional native package
// @napi-rs/canvas. That package is present in local node_modules, but a
// serverless bundle (Vercel) doesn't include it — pdf.js pulls it in through
// a dynamic createRequire() that output-file tracing can't follow — so the
// import itself fails with "DOMMatrix is not defined".
//
// We only ever read text and operator lists from a page, never rasterise it,
// so a minimal 2D affine DOMMatrix is all pdf.js needs from us. It is
// installed before pdf.js is imported and is used in every environment, so
// local and production behave the same.

type Init = ArrayLike<number> | undefined;

class DOMMatrixPolyfill {
  a = 1;
  b = 0;
  c = 0;
  d = 1;
  e = 0;
  f = 0;

  constructor(init?: Init) {
    if (init && init.length >= 6) {
      const [a, b, c, d, e, f] = Array.from(init);
      Object.assign(this, { a, b, c, d, e, f });
    }
  }

  get is2D() {
    return true;
  }
  get isIdentity() {
    return this.a === 1 && this.b === 0 && this.c === 0 && this.d === 1 && this.e === 0 && this.f === 0;
  }
  // 4x4 aliases some callers read.
  get m11() { return this.a; }
  get m12() { return this.b; }
  get m21() { return this.c; }
  get m22() { return this.d; }
  get m41() { return this.e; }
  get m42() { return this.f; }

  private set(m: DOMMatrixPolyfill) {
    Object.assign(this, { a: m.a, b: m.b, c: m.c, d: m.d, e: m.e, f: m.f });
    return this;
  }

  /** this × other (other applied first, then this). */
  multiply(other: DOMMatrixPolyfill): DOMMatrixPolyfill {
    const m = new DOMMatrixPolyfill();
    m.a = this.a * other.a + this.c * other.b;
    m.b = this.b * other.a + this.d * other.b;
    m.c = this.a * other.c + this.c * other.d;
    m.d = this.b * other.c + this.d * other.d;
    m.e = this.a * other.e + this.c * other.f + this.e;
    m.f = this.b * other.e + this.d * other.f + this.f;
    return m;
  }
  multiplySelf(other: DOMMatrixPolyfill) {
    return this.set(this.multiply(other));
  }
  preMultiplySelf(other: DOMMatrixPolyfill) {
    return this.set(other.multiply(this));
  }
  translate(tx = 0, ty = 0) {
    const t = new DOMMatrixPolyfill([1, 0, 0, 1, tx, ty]);
    return this.multiply(t);
  }
  translateSelf(tx = 0, ty = 0) {
    return this.set(this.translate(tx, ty));
  }
  scale(sx = 1, sy = sx) {
    const s = new DOMMatrixPolyfill([sx, 0, 0, sy, 0, 0]);
    return this.multiply(s);
  }
  scaleSelf(sx = 1, sy = sx) {
    return this.set(this.scale(sx, sy));
  }
  inverse(): DOMMatrixPolyfill {
    const det = this.a * this.d - this.b * this.c;
    const m = new DOMMatrixPolyfill();
    if (det === 0) {
      Object.assign(m, { a: NaN, b: NaN, c: NaN, d: NaN, e: NaN, f: NaN });
      return m;
    }
    m.a = this.d / det;
    m.b = -this.b / det;
    m.c = -this.c / det;
    m.d = this.a / det;
    m.e = (this.c * this.f - this.d * this.e) / det;
    m.f = (this.b * this.e - this.a * this.f) / det;
    return m;
  }
  invertSelf() {
    return this.set(this.inverse());
  }
  transformPoint(p: { x?: number; y?: number } = {}) {
    const x = p.x ?? 0;
    const y = p.y ?? 0;
    return { x: this.a * x + this.c * y + this.e, y: this.b * x + this.d * y + this.f, z: 0, w: 1 };
  }
  toFloat32Array() {
    const { a, b, c, d, e, f } = this;
    return new Float32Array([a, b, 0, 0, c, d, 0, 0, 0, 0, 1, 0, e, f, 0, 1]);
  }
  toFloat64Array() {
    return Float64Array.from(this.toFloat32Array());
  }
}

let installed = false;
function installDomPolyfills() {
  if (installed) return;
  installed = true;
  const g = globalThis as unknown as { DOMMatrix?: unknown };
  if (typeof g.DOMMatrix === "undefined") g.DOMMatrix = DOMMatrixPolyfill;
}

/** pdf.js's legacy Node build, with the DOM globals it needs at load time. */
export async function loadPdfjs() {
  installDomPolyfills();
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}
