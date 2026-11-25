/**
 * Tooltip shown on hover or keyboard focus of its parent control (CSS only).
 * The parent carries the accessible name; the tip is visual.
 */
export function Tip({ label, keys, side = "bottom" }: { label: string; keys?: string; side?: "right" | "bottom" | "top" | "left" }) {
  return (
    <span className="tip" data-side={side} aria-hidden="true">
      {label}
      {keys && <kbd>{keys}</kbd>}
    </span>
  );
}
