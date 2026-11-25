import { describe, expect, it } from "vitest";
import { shortcutCode } from "./keys";

describe("shortcutCode", () => {
  it("follows the letter on Latin layouts (AZERTY Ctrl+Z is the key marked Z)", () => {
    expect(shortcutCode({ key: "z", code: "KeyW" })).toBe("KeyZ");
    expect(shortcutCode({ key: "a", code: "KeyQ" })).toBe("KeyA");
    expect(shortcutCode({ key: "M", code: "Semicolon" })).toBe("KeyM");
    expect(shortcutCode({ key: "z", code: "KeyZ" })).toBe("KeyZ");
  });
  it("uses the key position on non-Latin layouts", () => {
    expect(shortcutCode({ key: "ئ", code: "KeyZ" })).toBe("KeyZ");
    expect(shortcutCode({ key: "ش", code: "KeyA" })).toBe("KeyA");
  });
  it("uses the position for keys that are not letters", () => {
    expect(shortcutCode({ key: "Delete", code: "Delete" })).toBe("Delete");
    expect(shortcutCode({ key: "&", code: "Digit1" })).toBe("Digit1");
    expect(shortcutCode({ key: " ", code: "Space" })).toBe("Space");
    expect(shortcutCode({ key: "F2", code: "F2" })).toBe("F2");
  });
});
