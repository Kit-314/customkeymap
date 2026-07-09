/* Tests for moveLayer / deleteLayer reference renumbering. Run: node test/layer_ops.test.js */
const assert = require('assert');
const E = require('../editor-engine.js');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m}\n  exp: ${JSON.stringify(b)}\n  got: ${JSON.stringify(a)}`); console.log('  ✓ ' + m); pass++; };

// Numeric references: layers 0=base, 1=lower, 2=raise.
const NUM = `/ {
    combos {
        compatible = "zmk,combos";
        c1 {
            timeout-ms = <50>;
            key-positions = <0 1>;
            bindings = <&kp ESC>;
            layers = <1 2>;
        };
    };

    keymap {
        compatible = "zmk,keymap";

        base {
            bindings = <&mo 1 &mo 2 &lt 2 SPACE &kp A>;
        };

        lower {
            bindings = <&to 0 &tog 2 &kp B &sl 1>;
        };

        raise {
            bindings = <&kp C &kp D &kp E &mo 1>;
        };
    };
};
`;

console.log('moveLayer (numeric refs): move raise(2) up to slot 1');
let m = E.parseKeymap(NUM);
let out = E.moveLayer(m, 2, 1);            // old order [0,1,2] -> [0,2,1]; remap 1->2, 2->1
let mp = E.parseKeymap(out);
eq(mp.layers.length, 3, 'still 3 layers');
eq(mp.layers.map(l => l.name).join(','), 'base,raise,lower', 'raise now sits before lower');
const bindOf = (model, i) => E.layerBindings(model, i).join(' ');
// base used &mo 1(lower→2) &mo 2(raise→1) &lt 2 SPACE(raise→1)
eq(bindOf(mp, 0), '&mo 2 &mo 1 &lt 1 SPACE &kp A', 'base refs renumbered (1->2, 2->1)');
ok(/layers = <2 1>/.test(out), 'combo layers list renumbered (1 2 -> 2 1)');
ok(out.includes('&to 0'), '&to 0 (base) unchanged');

console.log('deleteLayer (numeric refs): delete lower(1)');
m = E.parseKeymap(NUM);
const refs = E.countLayerRefs(m, 1);
eq(refs, 3, 'three binding refs point at lower (mo1 in base, sl1 in lower, mo1 in raise)');
out = E.deleteLayer(m, 1);                 // remap 0->0, 1->null, 2->1
mp = E.parseKeymap(out);
eq(mp.layers.length, 2, 'down to 2 layers');
eq(mp.layers.map(l => l.name).join(','), 'base,raise', 'lower removed');
// base: &mo 1(deleted→none) &mo 2(raise→1) &lt 2 SPACE(→1) &kp A
eq(bindOf(mp, 0), '&none &mo 1 &lt 1 SPACE &kp A', 'orphaned &mo 1 -> &none; raise refs -> 1');
// raise (now index1): &kp C &kp D &kp E &mo 1(deleted→none)
eq(bindOf(mp, 1), '&kp C &kp D &kp E &none', 'orphaned &mo 1 in raise -> &none');
ok(/layers = <1>/.test(out), 'combo layers <1 2> -> drop deleted 1, remap 2->1 => <1>');

console.log('round-trip: move there and back is identity');
m = E.parseKeymap(NUM);
const back = E.moveLayer(E.parseKeymap(E.moveLayer(m, 2, 0)), 0, 2);
eq(back, NUM, 'move 2->0 then 0->2 returns byte-identical original');

// #define-based references.
const DEF = `#define BASE 0
#define LOWER 1
#define RAISE 2

/ {
    keymap {
        compatible = "zmk,keymap";

        base {
            bindings = <&mo LOWER &mo RAISE &kp A>;
        };

        lower {
            bindings = <&to BASE &kp B>;
        };

        raise {
            bindings = <&kp C &mo LOWER>;
        };
    };
};
`;

console.log('moveLayer (#define refs): swap lower(1) and raise(2)');
m = E.parseKeymap(DEF);
out = E.moveLayer(m, 2, 1);                // remap 1->2, 2->1; names stay, #defines change
ok(out.includes('#define LOWER 2'), 'LOWER define remapped 1 -> 2');
ok(out.includes('#define RAISE 1'), 'RAISE define remapped 2 -> 1');
ok(out.includes('#define BASE 0'), 'BASE define unchanged');
ok(out.includes('&mo LOWER') && out.includes('&mo RAISE'), 'named bindings left intact (defines carry the remap)');
mp = E.parseKeymap(out);
eq(mp.layers.map(l => l.name).join(','), 'base,raise,lower', 'nodes reordered');

console.log('deleteLayer (#define refs): delete lower(1)');
m = E.parseKeymap(DEF);
out = E.deleteLayer(m, 1);                 // 1 deleted, 2->1
ok(!out.includes('#define LOWER'), 'LOWER define removed (its layer is gone)');
ok(out.includes('#define RAISE 1'), 'RAISE define remapped 2 -> 1');
ok(/&none\s+&mo RAISE|&mo RAISE/.test(out), 'RAISE bindings preserved');
ok(out.includes('&none'), 'orphaned &mo LOWER -> &none (named orphan handled)');
mp = E.parseKeymap(out);
eq(mp.layers.length, 2, 'two layers remain');

// conditional layers
const COND = `/ {
    conditional_layers {
        compatible = "zmk,conditional-layers";
        tri {
            if-layers = <1 2>;
            then-layer = <3>;
        };
    };
    keymap {
        compatible = "zmk,keymap";
        l0 { bindings = <&mo 1>; };
        l1 { bindings = <&mo 2>; };
        l2 { bindings = <&mo 3>; };
        l3 { bindings = <&kp A>; };
    };
};
`;
console.log('deleteLayer with conditional-layers: delete l1(1)');
m = E.parseKeymap(COND);
out = E.deleteLayer(m, 1);                  // 1->null, 2->1, 3->2
ok(/if-layers = <1>/.test(out), 'if-layers <1 2>: drop deleted 1, remap 2->1 => <1>');
ok(/then-layer = <2>/.test(out), 'then-layer 3 -> 2');
mp = E.parseKeymap(out);
eq(mp.layers.length, 3, 'three layers remain');

console.log('guards');
assert.throws(() => E.deleteLayer(E.parseKeymap(`/ { keymap { compatible="zmk,keymap"; only { bindings = <&kp A>; }; }; };`), 0), /only layer/);
console.log('  ✓ refuses to delete the only layer'); pass++;

console.log(`\nALL ${pass} ASSERTIONS PASSED`);
