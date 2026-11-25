/**
 * DOM overlay used only while a text object is being edited (the committed
 * text is drawn on the canvas). Positioned and sized to match the canvas
 * rendering at the current zoom.
 */
import type { Camera } from "./camera";
import type { TextStyle } from "./model";
import { TEXT_LINE_HEIGHT } from "./objects";
import { fontString } from "./text-layout";

export interface TextEditorCallbacks {
  /** The colour text is shown in (light on a dark board); the saved colour is unchanged. */
  inkColor?: (color: string) => string;
  /** Editing finished (Escape, Ctrl+Enter or focus left the editor). */
  onDone: () => void;
  /** Ctrl+Shift+> / < pressed: next text size up or down. */
  onSizeStep?: (dir: 1 | -1) => void;
}

export class TextEditor {
  readonly el: HTMLDivElement;
  private x = 0;
  private y = 0;
  private style: TextStyle;
  private readonly rotation: number;
  /** Fixed width the text wraps to, if any (board units). */
  private readonly boxWidth: number | undefined;
  private done = false;

  constructor(
    root: HTMLElement,
    init: {
      x: number;
      y: number;
      rotation: number;
      text: string;
      style: TextStyle;
      caretAt?: { clientX: number; clientY: number };
      boxWidth?: number;
    },
    cam: Camera,
    private readonly cb: TextEditorCallbacks,
  ) {
    this.x = init.x;
    this.y = init.y;
    this.style = init.style;
    this.rotation = init.rotation;
    this.boxWidth = init.boxWidth;
    const el = document.createElement("div");
    el.className = "nlb-text-editor";
    el.contentEditable = "plaintext-only";
    el.spellcheck = false;
    el.setAttribute("role", "textbox");
    el.setAttribute("aria-multiline", "true");
    el.setAttribute("aria-label", "Text");
    el.textContent = init.text;
    this.el = el;
    Object.assign(el.style, {
      position: "absolute",
      zIndex: "1",
      margin: "0",
      padding: "0",
      minWidth: "2px",
      // A fixed box wraps like the board draws it; otherwise lines break only at Enter.
      whiteSpace: init.boxWidth !== undefined ? "pre-wrap" : "pre",
      overflowWrap: init.boxWidth !== undefined ? "anywhere" : "normal",
      unicodeBidi: "plaintext",
      outline: "none",
      border: "0",
      background: "transparent",
      userSelect: "text",
      webkitUserSelect: "text",
      cursor: "text",
      caretColor: "#0b7a75",
      transformOrigin: "0 0",
    } satisfies Partial<CSSStyleDeclaration>);
    el.addEventListener("pointerdown", (e) => e.stopPropagation());
    el.addEventListener("dblclick", (e) => e.stopPropagation());
    el.addEventListener("keydown", this.onKeyDown);
    el.addEventListener("blur", this.finish);
    root.append(el);
    this.layout(cam);
    el.focus();
    this.placeCaret(init.caretAt);
    // A double-click's default word selection lands after this; put the caret back.
    requestAnimationFrame(() => {
      if (!this.done) this.placeCaret(init.caretAt);
    });
  }

  /** Caret at a client point inside the text, or at the end. */
  placeCaret(at?: { clientX: number; clientY: number }): void {
    const sel = window.getSelection();
    if (!sel) return;
    let range: Range | null = null;
    if (at && typeof document.caretPositionFromPoint === "function") {
      const pos = document.caretPositionFromPoint(at.clientX, at.clientY);
      if (pos && this.el.contains(pos.offsetNode)) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(this.el);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
  }

  get text(): string {
    // innerText keeps line breaks typed with Enter.
    return (this.el.innerText ?? "").replace(/\n$/, "");
  }

  get textStyle(): TextStyle {
    return this.style;
  }

  setStyle(style: TextStyle, cam: Camera): void {
    this.style = style;
    this.layout(cam);
  }

  layout(cam: Camera): void {
    const s = this.el.style;
    s.left = `${(this.x - cam.x) * cam.zoom}px`;
    s.top = `${(this.y - cam.y) * cam.zoom}px`;
    s.font = fontString(this.style, cam.zoom);
    s.lineHeight = `${this.style.fontSize * TEXT_LINE_HEIGHT * cam.zoom}px`;
    s.color = this.cb.inkColor ? this.cb.inkColor(this.style.color) : this.style.color;
    s.textAlign = this.style.align;
    s.transform = this.rotation ? `rotate(${this.rotation}rad)` : "";
    if (this.boxWidth !== undefined) s.width = `${this.boxWidth * cam.zoom}px`;
  }

  /** Removes the editor without calling back. */
  destroy(): void {
    this.done = true;
    this.el.removeEventListener("blur", this.finish);
    this.el.remove();
  }

  private finish = (): void => {
    if (this.done) return;
    this.done = true;
    this.cb.onDone();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    e.stopPropagation();
    if (e.key === "Escape" || (e.key === "Enter" && (e.ctrlKey || e.metaKey))) {
      e.preventDefault();
      this.finish();
    } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === "Period" || e.code === "Comma")) {
      e.preventDefault();
      this.cb.onSizeStep?.(e.code === "Period" ? 1 : -1);
    }
  };
}
