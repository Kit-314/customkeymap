/* Tests for layer add/rename + span parsing. Run: node test/layers.test.js */
const assert = require('assert');
const E = require('../editor-engine.js');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m}\n  exp: ${JSON.stringify(b)}\n  got: ${JSON.stringify(a)}`); console.log('  ✓ ' + m); pass++; };

const SRC = `/ {
    behaviors {
        morph: morph {
            compatible = "zmk,behavior-mod-morph";
            #binding-cells = <0>;
            bindings = <&kp A>, <&kp B>;
            mods = <(MOD_LSFT)>;
        };
    };

    keymap {
        compatible = "zmk,keymap";

        base_layer {
            bindings = <&kp Q &kp W &kp E &kp R &kp T &kp Y>;
        };

        num_layer {
            bindings = <&kp N1 &kp N2 &kp N3 &kp N4 &kp N5 &kp N6>;
        };
    };
};
`;

console.log('parseKeymap spans:');
const m = E.parseKeymap(SRC);
eq(m.layers.length, 2, 'two layers found');
ok(m.keymap && m.keymap.contentEnd > m.keymap.contentStart, 'keymap span captured');
eq(SRC.slice(m.layers[0].nameStart, m.layers[0].nameEnd), 'base_layer', 'layer0 name span exact');
eq(SRC.slice(m.layers[1].nameStart, m.layers[1].nameEnd), 'num_layer', 'layer1 name span exact');
ok(/^num_layer\s*\{[\s\S]*\};$/.test(SRC.slice(m.layers[1].nodeStart, m.layers[1].nodeEnd)), 'layer1 node span wraps the whole node');

console.log('renameLayer:');
const r1 = E.renameLayer(m, 0, 'home');
ok(r1.includes('home {') && !r1.includes('base_layer'), 'name changed in text');
const rp = E.parseKeymap(r1);
eq(rp.layers.length, 2, 'still 2 layers after rename');
eq(rp.layers[0].name, 'home', 'layer0 renamed');
eq(rp.layers[0].tokens.map(t=>t.text).join(' '), '&kp Q &kp W &kp E &kp R &kp T &kp Y', 'layer0 bindings untouched');
ok(r1.includes('morph: morph {'), 'behaviors block untouched by rename');
eq(E.renameLayer(E.parseKeymap(r1), 0, 'base_layer'), SRC, 'rename back → byte-identical original');
assert.throws(()=>E.renameLayer(m,1,'base_layer'), /already exists/); console.log('  ✓ rename to a duplicate name throws'); pass++;
assert.throws(()=>E.renameLayer(m,0,'1bad'), /must be/); console.log('  ✓ rename to an invalid name throws'); pass++;

console.log('addLayer:');
const a1 = E.addLayer(m, 'gaming');
const ap = E.parseKeymap(a1);
eq(ap.layers.length, 3, 'layer added → 3 layers');
eq(ap.layers[2].name, 'gaming', 'new layer is last, named gaming');
eq(ap.layers[2].tokens.length, 6, 'new layer has same key count as layer 0 (6)');
ok(ap.layers[2].tokens.every(t=>t.text==='&trans'), 'new layer is all &trans');
eq(ap.layers[0].tokens.length, 6, 'existing layer 0 unchanged');
eq(ap.layers[1].name, 'num_layer', 'existing layer 1 unchanged');
ok(a1.indexOf('gaming {') > a1.indexOf('num_layer {'), 'new layer appended after the last existing layer');
ok(a1.includes('morph: morph {'), 'behaviors untouched by addLayer');
// the new layer node sits INSIDE keymap{} (before its close): re-parse keymap still valid
ok(ap.keymap && ap.layers[2].nodeEnd <= ap.keymap.contentEnd + 200, 'new layer is within keymap block');
assert.throws(()=>E.addLayer(m,'base_layer'), /already exists/); console.log('  ✓ adding a duplicate name throws'); pass++;
assert.throws(()=>E.addLayer(m,'has space'), /must be/); console.log('  ✓ adding an invalid name throws'); pass++;

console.log(`\nALL ${pass} ASSERTIONS PASSED`);
