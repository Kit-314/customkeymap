/* Sanity tests for the keycode catalog. Run: node test/keycodes.test.js */
const assert = require('assert');
const C = require('../keycodes.js');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m}: expected ${b}, got ${a}`); console.log('  ✓ ' + m); pass++; };

ok(C.KEYCODES.length > 120, `catalog has a substantial set (${C.KEYCODES.length} codes)`);
ok(C.KEYCODES.every(k => k.code && k.label && k.cat), 'every entry has code + label + cat');
const codes = C.KEYCODES.map(k => k.code);
eq(new Set(codes).size, codes.length, 'no duplicate codes');
eq(C.KEYCODES.filter(k => k.cat === 'Letters').length, 26, '26 letters');
eq(C.KEYCODES.filter(k => k.cat === 'Function').length, 24, 'F1-F24');
eq(C.byCode.get('SEMI').label, ';', 'SEMI maps to ";"');
eq(C.byCode.get('DOT').label, '.', 'DOT maps to "."');

// search
eq(C.search('ESC', 1)[0].code, 'ESC', 'search "ESC" → ESC first');
eq(C.search(';', 1)[0].code, 'SEMI', 'search literal ";" → SEMI');
eq(C.search('vol', 5).every(k => /vol/i.test(k.code) || /vol/i.test(k.label)), true, 'search "vol" all relevant');
ok(C.search('A', 3).some(k => k.code === 'A'), 'search "A" includes the A key');

eq(C.MODIFIERS.length, 8, '8 modifiers (L/R × shift/ctrl/alt/gui)');
ok(C.MODIFIERS.find(m => m.code === 'LGUI'), 'LGUI modifier present');

console.log(`\nALL ${pass} ASSERTIONS PASSED`);
