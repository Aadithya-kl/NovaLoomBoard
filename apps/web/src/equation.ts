/**
 * Typed equations: TeX rendered by MathJax (Apache-2.0) to SVG, then drawn as a PNG image
 * for the board (crisp at four times its size). MathJax loads on first use only.
 *
 * Only packages that produce plain mathematics are enabled: no links, no interactive
 * commands (the "html" and "action" packages are left out), since the live preview shows
 * the generated SVG in the page.
 */
const PACKAGES = ["base", "ams", "boldsymbol", "braket", "cancel", "cases", "color", "gensymb", "mathtools", "mhchem", "newcommand", "noundefined", "upgreek", "textmacros"];

type Convert = (tex: string) => SVGSVGElement;
let loading: Promise<Convert> | null = null;

function load(): Promise<Convert> {
  loading ??= (async () => {
    const [{ mathjax }, { TeX }, { SVG }, { browserAdaptor }, { RegisterHTMLHandler }] = await Promise.all([
      import("mathjax-full/js/mathjax.js"),
      import("mathjax-full/js/input/tex.js"),
      import("mathjax-full/js/output/svg.js"),
      import("mathjax-full/js/adaptors/browserAdaptor.js"),
      import("mathjax-full/js/handlers/html.js"),
      import("mathjax-full/js/input/tex/AllPackages.js"),
    ]);
    const adaptor = browserAdaptor();
    RegisterHTMLHandler(adaptor);
    const doc = mathjax.document(document, {
      InputJax: new TeX({ packages: PACKAGES }),
      // Each equation carries its own glyph shapes: no shared cache, so it stands alone.
      OutputJax: new SVG({ fontCache: "none" }),
    });
    return (tex: string) => {
      const node = doc.convert(tex, { display: true }) as HTMLElement;
      const svg = node.querySelector("svg");
      if (!svg) throw new Error("nothing to show");
      return svg as SVGSVGElement;
    };
  })();
  return loading;
}

export interface RenderedEquation {
  /** SVG markup for the preview. */
  svg: string;
  /** Size in board units at the given font size. */
  width: number;
  height: number;
}

/** MathJax sizes equations in ex; one ex is about this fraction of the font size. */
const EX = 0.45;

/** The equation as SVG and its size at `fontSize`, or the reason it cannot be shown. */
export async function renderEquation(tex: string, color: string, fontSize: number): Promise<RenderedEquation | { error: string }> {
  // Control characters (from pasted text) mean nothing in TeX and can break MathJax: read them as spaces.
  // eslint-disable-next-line no-control-regex
  const src = tex.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
  if (!src) return { error: "Type an equation" };
  let svg: SVGSVGElement;
  try {
    svg = (await load())(src);
  } catch (err) {
    return { error: (err as Error).message };
  }
  const err = svg.querySelector('[data-mml-node="merror"]');
  if (err) return { error: err.getAttribute("data-mjx-error") || err.textContent || "This equation cannot be read" };
  const ex = (v: string | null) => parseFloat(v ?? "0") || 0;
  const width = Math.max(1, ex(svg.getAttribute("width")) * EX * fontSize);
  const height = Math.max(1, ex(svg.getAttribute("height")) * EX * fontSize);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  // MathJax draws with currentColor.
  svg.setAttribute("style", `color:${color}`);
  return { svg: svg.outerHTML, width, height };
}

/** Draws rendered SVG into a PNG at `scale` pixels per board unit (at most 4096 px a side). */
export async function equationPng(eq: RenderedEquation, scale = 4): Promise<Uint8Array> {
  const k = Math.min(scale, 4096 / eq.width, 4096 / eq.height);
  const url = URL.createObjectURL(new Blob([eq.svg], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.decoding = "async";
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error("the equation could not be drawn"));
      img.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(eq.width * k));
    canvas.height = Math.max(1, Math.round(eq.height * k));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("the equation could not be drawn");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    canvas.width = canvas.height = 0;
    if (!blob) throw new Error("the equation could not be drawn");
    return new Uint8Array(await blob.arrayBuffer());
  } finally {
    URL.revokeObjectURL(url);
  }
}
