/* Tests for conditional-layer add/remove/parse. Run: node test/conditional_layers.test.js */
const assert = require('assert');
const E = require('../editor-engine.js');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m}\n  exp: ${JSON.stringify(b)}\n  got: ${JSON.stringify(a)}`); console.log('  ✓ ' + m); pass++; };

const SRC = `/ {
    conditional_layers {
        compatible = "zmk,conditional-layers";
        tri {
            if-layers = <1 2>;
            then-layer = <3>;
        };
    };

    keymap {
        compatible = "zmk,keymap";
        default_layer { bindings = <&kp Q &kp W &kp E &kp R>; };
    };
};
`;

console.log('parseConditionalLayers:');
const m = E.parseKeymap(SRC);
const pc = E.parseConditionalLayers(m);
eq(pc.conds.length, 1, 'one conditional layer parsed');
eq(pc.conds[0].name, 'tri', 'conditional name');
eq(pc.conds[0].ifLayers.join(','), '1,2', 'if-layers parsed');
eq(pc.conds[0].thenLayer, 3, 'then-layer parsed');

console.log('addConditionalLayer (into existing block):');
const out = E.addConditionalLayer(m, { name: 'adj', ifLayers: [1, 3], thenLayer: 4 });
const m2 = E.parseKeymap(out); const pc2 = E.parseConditionalLayers(m2);
eq(pc2.conds.length, 2, 'added → 2');
eq(pc2.conds[1].name, 'adj', 'new conditional present');
eq(pc2.conds[1].ifLayers.join(','), '1,3', 'new if-layers');
eq(pc2.conds[1].thenLayer, 4, 'new then-layer');
ok(out.includes('tri {'), 'existing conditional preserved');
eq(E.parseKeymap(out).layers.length, 1, 'keymap untouched (1 layer)');

console.log('removeConditionalLayer round-trip:');
const back = E.removeConditionalLayer(m2, 1);
eq(E.parseConditionalLayers(E.parseKeymap(back)).conds.length, 1, 'removed → back to 1');
eq(back, SRC, 'add then remove → byte-identical original');

console.log('addConditionalLayer when no conditional_layers{} block exists:');
const NONE = `/ {\n    keymap {\n        compatible = "zmk,keymap";\n        default_layer { bindings = <&kp Q &kp W>; };\n    };\n};\n`;
const out2 = E.addConditionalLayer(E.parseKeymap(NONE), { name: 'c1', ifLayers: [1, 2], thenLayer: 3 });
ok(/conditional_layers\s*\{/.test(out2) && out2.includes('compatible = "zmk,conditional-layers"'), 'conditional_layers{} block created');
eq(E.parseConditionalLayers(E.parseKeymap(out2)).conds.length, 1, 'one conditional in new block');
eq(E.parseKeymap(out2).layers.length, 1, 'keymap still parses');

console.log('validation:');
ok(E.conditionalNameError(m, 'tri'), 'duplicate name rejected');
ok(E.conditionalNameError(m, '9bad'), 'invalid name rejected');
eq(E.conditionalNameError(m, 'fresh'), null, 'fresh valid name accepted');

console.log(`\nALL ${pass} ASSERTIONS PASSED`);
