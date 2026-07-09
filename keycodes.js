/* ZMK keycode catalog for the editor's key picker. DOM-free, node-testable.
   Each entry: { code, label, cat }. `code` is the ZMK keycode as written after
   &kp / &mt <tap> / &lt <tap> / &sk. Modifiers (for &mt hold / &sk) are listed
   separately in MODIFIERS. Behaviours like &mo/&bt/&rgb_ug/&mkp aren't here; they
   belong in the behaviour picker, not the keycode picker. */
(function (root) {
  'use strict';

  // Letters A-Z
  const letters = [];
  for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); letters.push({ code: c, label: c, cat: 'Letters' }); }

  const numbers = [
    ['N1', '1'], ['N2', '2'], ['N3', '3'], ['N4', '4'], ['N5', '5'],
    ['N6', '6'], ['N7', '7'], ['N8', '8'], ['N9', '9'], ['N0', '0'],
  ].map(([code, label]) => ({ code, label, cat: 'Numbers' }));

  const symbols = [
    ['GRAVE', '`'], ['MINUS', '-'], ['EQUAL', '='], ['LBKT', '['], ['RBKT', ']'], ['BSLH', '\\'],
    ['SEMI', ';'], ['SQT', "'"], ['COMMA', ','], ['DOT', '.'], ['FSLH', '/'],
    ['TILDE', '~'], ['UNDER', '_'], ['PLUS', '+'], ['LBRC', '{'], ['RBRC', '}'], ['PIPE', '|'],
    ['COLON', ':'], ['DQT', '"'], ['LT', '<'], ['GT', '>'], ['QMARK', '?'],
    ['EXCL', '!'], ['AT', '@'], ['HASH', '#'], ['DLLR', '$'], ['PRCNT', '%'],
    ['CARET', '^'], ['AMPS', '&'], ['STAR', '*'], ['LPAR', '('], ['RPAR', ')'],
  ].map(([code, label]) => ({ code, label, cat: 'Symbols' }));

  const edit = [
    ['SPACE', 'Space'], ['ENTER', 'Enter'], ['RET', 'Return'], ['TAB', 'Tab'], ['ESC', 'Esc'],
    ['BSPC', 'Backspace'], ['DEL', 'Delete'], ['INS', 'Insert'], ['CAPS', 'Caps Lock'],
  ].map(([code, label]) => ({ code, label, cat: 'Whitespace & Editing' }));

  const nav = [
    ['LEFT', '← Left'], ['RIGHT', '→ Right'], ['UP', '↑ Up'], ['DOWN', '↓ Down'],
    ['HOME', 'Home'], ['END', 'End'], ['PG_UP', 'Page Up'], ['PG_DN', 'Page Down'],
  ].map(([code, label]) => ({ code, label, cat: 'Navigation' }));

  const fkeys = [];
  for (let i = 1; i <= 24; i++) fkeys.push({ code: 'F' + i, label: 'F' + i, cat: 'Function' });

  const numpad = [
    ['KP_N0', 'Num 0'], ['KP_N1', 'Num 1'], ['KP_N2', 'Num 2'], ['KP_N3', 'Num 3'], ['KP_N4', 'Num 4'],
    ['KP_N5', 'Num 5'], ['KP_N6', 'Num 6'], ['KP_N7', 'Num 7'], ['KP_N8', 'Num 8'], ['KP_N9', 'Num 9'],
    ['KP_PLUS', 'Num +'], ['KP_MINUS', 'Num −'], ['KP_MULTIPLY', 'Num ×'], ['KP_DIVIDE', 'Num ÷'],
    ['KP_ENTER', 'Num Enter'], ['KP_DOT', 'Num .'], ['KP_EQUAL', 'Num ='], ['KP_NUM', 'Num Lock'],
  ].map(([code, label]) => ({ code, label, cat: 'Numpad' }));

  const media = [
    ['C_MUTE', 'Mute'], ['C_VOL_UP', 'Volume Up'], ['C_VOL_DN', 'Volume Down'],
    ['C_PP', 'Play / Pause'], ['C_NEXT', 'Next Track'], ['C_PREV', 'Prev Track'], ['C_STOP', 'Stop'],
    ['C_BRI_UP', 'Brightness Up'], ['C_BRI_DN', 'Brightness Down'],
  ].map(([code, label]) => ({ code, label, cat: 'Media' }));

  const system = [
    ['PSCRN', 'Print Screen'], ['SLCK', 'Scroll Lock'], ['PAUSE_BREAK', 'Pause/Break'], ['K_APP', 'Menu'],
  ].map(([code, label]) => ({ code, label, cat: 'System' }));

  const ALL = [].concat(letters, numbers, symbols, edit, nav, fkeys, numpad, media, system);

  const MODIFIERS = [
    ['LSHFT', 'Left Shift'], ['LCTRL', 'Left Ctrl'], ['LALT', 'Left Alt'], ['LGUI', 'Left GUI/Cmd'],
    ['RSHFT', 'Right Shift'], ['RCTRL', 'Right Ctrl'], ['RALT', 'Right Alt'], ['RGUI', 'Right GUI/Cmd'],
  ].map(([code, label]) => ({ code, label }));

  const byCode = new Map(ALL.map(k => [k.code, k]));
  const CATS = [...new Set(ALL.map(k => k.cat))];

  // Search by code or label (case-insensitive substring); also lets a user type
  // the literal character (e.g. ";" finds SEMI). Returns up to `limit` matches.
  function search(q, limit) {
    q = (q || '').trim();
    if (!q) return ALL.slice(0, limit || ALL.length);
    const ql = q.toLowerCase();
    const scored = [];
    for (const k of ALL) {
      const code = k.code.toLowerCase(), label = k.label.toLowerCase();
      let s = -1;
      if (code === ql || label === ql || k.label === q) s = 0;       // exact
      else if (code.startsWith(ql) || label.startsWith(ql)) s = 1;   // prefix
      else if (code.includes(ql) || label.includes(ql)) s = 2;       // substring
      else if (k.label === q) s = 0;
      if (s >= 0) scored.push([s, k]);
    }
    scored.sort((a, b) => a[0] - b[0]);
    const r = scored.map(x => x[1]);
    return limit ? r.slice(0, limit) : r;
  }

  const api = { KEYCODES: ALL, MODIFIERS, CATS, byCode, search };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KeyCatalog = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
