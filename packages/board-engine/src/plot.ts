/**
 * Plotting y = f(x) on the coordinate grid. Formulas are parsed here (never evaluated as
 * code) and accept what people type: "y = 2x² − 3", "f(x) = sin(x)/x", "3,5x" with a
 * decimal comma, √, π, × and ÷, implicit multiplication ("2x", "3(x+1)", "x sin x").
 */
import { AXIS_UNIT } from "./paper";

type Node =
  | { k: "num"; v: number }
  | { k: "x" }
  | { k: "neg"; a: Node }
  | { k: "bin"; op: "+" | "-" | "*" | "/" | "^"; a: Node; b: Node }
  | { k: "fn"; f: FnName; a: Node };

const FUNCTIONS = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  exp: Math.exp,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
} as const;
type FnName = keyof typeof FUNCTIONS;
const FN_NAMES = (Object.keys(FUNCTIONS) as FnName[]).sort((a, b) => b.length - a.length);

type Token = { t: "num"; v: number } | { t: "x" } | { t: "op"; v: "+" | "-" | "*" | "/" | "^" } | { t: "(" } | { t: ")" } | { t: "fn"; v: FnName } | { t: "const"; v: number };

const SUPERSCRIPTS: Record<string, string> = { "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9", "⁻": "-" };

/** Tidies what people type into the plain form the parser reads. */
function normalize(src: string): string {
  let s = src.trim().toLowerCase();
  // "y =", "f(x) =", "y(x) ="
  s = s.replace(/^\s*(?:y|f\s*\(\s*x\s*\)|y\s*\(\s*x\s*\))\s*=\s*/, "");
  s = s.replace(/[−–—]/g, "-").replace(/[×·∙]/g, "*").replace(/÷/g, "/").replace(/π/g, "pi").replace(/√/g, "sqrt");
  // Superscripts: x² → x^(2), x⁻¹ → x^(-1)
  s = s.replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹⁻]+/g, (m) => `^(${[...m].map((c) => SUPERSCRIPTS[c]).join("")})`);
  // A decimal comma (there are no functions of several arguments).
  s = s.replace(/(\d),(\d)/g, "$1.$2");
  return s;
}

function tokenize(s: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i]!;
    if (c === " ") {
      i++;
      continue;
    }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/.exec(s.slice(i));
    if (num) {
      out.push({ t: "num", v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    if ("+-*/^".includes(c)) {
      out.push({ t: "op", v: c as "+" });
      i++;
      continue;
    }
    if (c === "(" || c === "[") {
      out.push({ t: "(" });
      i++;
      continue;
    }
    if (c === ")" || c === "]") {
      out.push({ t: ")" });
      i++;
      continue;
    }
    const rest = s.slice(i);
    const fn = FN_NAMES.find((f) => rest.startsWith(f));
    if (fn) {
      out.push({ t: "fn", v: fn });
      i += fn.length;
      continue;
    }
    if (rest.startsWith("pi")) {
      out.push({ t: "const", v: Math.PI });
      i += 2;
      continue;
    }
    if (c === "e") {
      out.push({ t: "const", v: Math.E });
      i++;
      continue;
    }
    if (c === "x") {
      out.push({ t: "x" });
      i++;
      continue;
    }
    throw new Error(`"${c}" is not understood here`);
  }
  return out;
}

/** Recursive descent: sums, products (with implicit multiplication), unary minus, powers, calls. */
function parse(tokens: Token[]): Node {
  let i = 0;
  const peek = () => tokens[i];
  const startsValue = (t: Token | undefined) => !!t && (t.t === "num" || t.t === "x" || t.t === "(" || t.t === "fn" || t.t === "const");

  function sum(): Node {
    let a = product();
    for (let t = peek(); t?.t === "op" && (t.v === "+" || t.v === "-"); t = peek()) {
      i++;
      a = { k: "bin", op: t.v, a, b: product() };
    }
    return a;
  }
  function product(): Node {
    let a = unary();
    for (;;) {
      const t = peek();
      if (t?.t === "op" && (t.v === "*" || t.v === "/")) {
        i++;
        a = { k: "bin", op: t.v, a, b: unary() };
      } else if (startsValue(t)) {
        // "2x", "3(x+1)", "x sin x"
        a = { k: "bin", op: "*", a, b: unary() };
      } else return a;
    }
  }
  function unary(): Node {
    const t = peek();
    if (t?.t === "op" && (t.v === "-" || t.v === "+")) {
      i++;
      const a = unary();
      return t.v === "-" ? { k: "neg", a } : a;
    }
    return power();
  }
  function power(): Node {
    const base = atom();
    const t = peek();
    if (t?.t === "op" && t.v === "^") {
      i++;
      // Right-associative, and "-x^2" is -(x^2): the exponent may carry its own sign.
      return { k: "bin", op: "^", a: base, b: unary() };
    }
    return base;
  }
  function atom(): Node {
    const t = tokens[i++];
    if (!t) throw new Error("the formula ends too early");
    switch (t.t) {
      case "num":
        return { k: "num", v: t.v };
      case "const":
        return { k: "num", v: t.v };
      case "x":
        return { k: "x" };
      case "(": {
        const a = sum();
        if (tokens[i++]?.t !== ")") throw new Error("a bracket is not closed");
        return a;
      }
      case "fn": {
        // "sin(x)", and also "sin x" or "sin 2x" without brackets.
        if (peek()?.t === "(") return { k: "fn", f: t.v, a: atom() };
        // Without brackets the argument runs to the next operator: "sin 2x" is sin(2x).
        let a = power();
        while (startsValue(peek()) && peek()!.t !== "fn") a = { k: "bin", op: "*", a, b: power() };
        return { k: "fn", f: t.v, a };
      }
      default:
        throw new Error(t.t === ")" ? "there is a closing bracket too many" : "an operator is missing a number");
    }
  }
  const tree = sum();
  if (i < tokens.length) throw new Error(tokens[i]!.t === ")" ? "there is a closing bracket too many" : "something is left over at the end");
  return tree;
}

function evaluate(n: Node, x: number): number {
  switch (n.k) {
    case "num":
      return n.v;
    case "x":
      return x;
    case "neg":
      return -evaluate(n.a, x);
    case "fn":
      return FUNCTIONS[n.f](evaluate(n.a, x));
    case "bin": {
      const a = evaluate(n.a, x);
      const b = evaluate(n.b, x);
      switch (n.op) {
        case "+":
          return a + b;
        case "-":
          return a - b;
        case "*":
          return a * b;
        case "/":
          return a / b;
        case "^":
          // Odd roots of negative numbers: (-8)^(1/3) = -2, as on a calculator.
          if (a < 0 && !Number.isInteger(b)) {
            const inv = 1 / b;
            if (Number.isInteger(Math.round(inv)) && Math.abs(inv - Math.round(inv)) < 1e-9 && Math.round(inv) % 2 !== 0) return -Math.pow(-a, b);
          }
          return Math.pow(a, b);
      }
    }
  }
}

/** A function of x from a typed formula, or the reason it cannot be read. */
export function parseFormula(src: string): { f: (x: number) => number } | { error: string } {
  const s = normalize(src);
  if (!s) return { error: "Type a formula, for example y = x² − 2" };
  if (s.length > 300) return { error: "The formula is too long" };
  try {
    const tree = parse(tokenize(s));
    return { f: (x) => evaluate(tree, x) };
  } catch (err) {
    return { error: `This formula cannot be read: ${(err as Error).message}` };
  }
}

/**
 * The curve of f over [xMin, xMax] (grid units) as polylines in board coordinates (one
 * AXIS_UNIT per grid unit, up is positive), sampled every `step` units. The curve is broken
 * where f is undefined or jumps off the visible range (tan x, 1/x), so no false vertical lines.
 */
export function plotCurve(f: (x: number) => number, xMin: number, xMax: number, yMin: number, yMax: number, step: number): number[][] {
  const out: number[][] = [];
  let cur: number[] = [];
  const span = yMax - yMin;
  const lo = yMin - span * 2;
  const hi = yMax + span * 2;
  let prev: number | null = null;
  const flush = () => {
    if (cur.length >= 4) out.push(cur);
    cur = [];
  };
  const n = Math.min(20000, Math.ceil((xMax - xMin) / step));
  for (let i = 0; i <= n; i++) {
    const x = xMin + ((xMax - xMin) * i) / n;
    const y = f(x);
    if (!Number.isFinite(y) || y < lo || y > hi) {
      flush();
      prev = null;
      continue;
    }
    // A jump of more than the whole visible height between neighbours is a pole, not a line.
    if (prev !== null && Math.abs(y - prev) > span) flush();
    cur.push(x * AXIS_UNIT, -y * AXIS_UNIT);
    prev = y;
  }
  flush();
  return out;
}
