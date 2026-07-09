/* Tests for combo add/remove/parse. Run: node test/combos.test.js */
const assert = require('assert');
const E = require('../editor-engine.js');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m}\n  exp: ${JSON.stringify(b)}\n  got: ${JSON.stringify(a)}`); console.log('  ✓ ' + m); pass++; };

const SRC = `/ {
    combos {
        compatible = "zmk,combos";
        c_esc {
            timeout-ms = <50>;
            key-positions = <0 1>;
            bindings = <&kp ESC>;
        };
        c_tab {
            timeout-ms = <40>;
            key-positions = <1 2>;
            bindings = <&kp TAB>;
            layers = <0 1>;
        };
    };

    keymap {
        compatible = "zmk,keymap";
        default_layer { bindings = <&kp Q &kp W &kp E &kp R>; };
    };
};
`;

console.log('parseCombos:');
const m = E.parseKeymap(SRC);
const pc = E.parseCombos(m);
eq(pc.combos.length, 2, 'two combos parsed');
eq(pc.combos[0].name, 'c_esc', 'combo 0 name');
eq(pc.combos[0].positions.join(','), '0,1', 'combo 0 positions');
eq(pc.combos[0].binding, '&kp ESC', 'combo 0 binding');
eq(pc.combos[0].layers, null, 'combo 0 has no layers restriction');
eq(pc.combos[1].positions.join(','), '1,2', 'combo 1 positions');
eq(pc.combos[1].layers.join(','), '0,1', 'combo 1 layers');

console.log('addCombo (into existing block):');
const out = E.addCombo(m, { name: 'c_caps', keyPositions: [3, 4], binding: '&kp CAPS', timeoutMs: 50 });
const m2 = E.parseKeymap(out); const pc2 = E.parseCombos(m2);
eq(pc2.combos.length, 3, 'combo added → 3');
eq(pc2.combos[2].name, 'c_caps', 'new combo present');
eq(pc2.combos[2].positions.join(','), '3,4', 'new combo positions');
ok(out.includes('c_esc {') && out.includes('c_tab {'), 'existing combos preserved');
eq(E.parseKeymap(out).layers.length, 1, 'keymap untouched (1 layer)');

console.log('removeCombo round-trip:');
const back = E.removeCombo(m2, 2);
const pcBack = E.parseCombos(E.parseKeymap(back));
eq(pcBack.combos.length, 2, 'removed → back to 2 combos');
eq(pcBack.combos.map(c=>c.name).join(','), 'c_esc,c_tab', 'the right combos remain');
eq(back, SRC, 'add then remove → byte-identical original');

console.log('addCombo when no combos{} block exists:');
const NOCOMBO = `/ {\n    keymap {\n        compatible = "zmk,keymap";\n        default_layer { bindings = <&kp Q &kp W>; };\n    };\n};\n`;
const out2 = E.addCombo(E.parseKeymap(NOCOMBO), { name: 'c1', keyPositions: [0, 1], binding: '&kp ESC' });
ok(/combos\s*\{/.test(out2) && out2.includes('compatible = "zmk,combos"'), 'combos{} block created');
eq(E.parseCombos(E.parseKeymap(out2)).combos.length, 1, 'one combo in new block');
eq(E.parseKeymap(out2).layers.length, 1, 'keymap still parses');

console.log('validation:');
ok(E.comboNameError(m, 'c_esc'), 'duplicate combo name rejected');
ok(E.comboNameError(m, '9bad'), 'invalid combo name rejected');
eq(E.comboNameError(m, 'c_new'), null, 'fresh valid name accepted');

console.log(`\nALL ${pass} ASSERTIONS PASSED`);
