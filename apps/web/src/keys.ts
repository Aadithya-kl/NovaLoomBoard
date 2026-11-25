/**
 * The key a shortcut refers to, in KeyboardEvent.code form ("KeyZ", "Delete", ...).
 *
 * Letters follow the layout when it types Latin letters, so Ctrl+Z is the key marked Z
 * on AZERTY and QWERTZ as on QWERTY. On layouts that do not type Latin letters
 * (Arabic, for example), the key's position is used instead, as on a US keyboard.
 * Every other key (arrows, Delete, digits, function keys) always uses its position.
 */
export function shortcutCode(e: Pick<KeyboardEvent, "key" | "code">): string {
  return /^[a-z]$/i.test(e.key) ? `Key${e.key.toUpperCase()}` : e.code;
}
