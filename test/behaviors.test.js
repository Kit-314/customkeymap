/* Tests for behaviour authoring (addBehavior/behaviorNode). Run: node test/behaviors.test.js */
const assert = require('assert');
const E = require('../editor-engine.js');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m}\n  exp: ${JSON.stringify(b)}\n  got: ${JSON.stringify(a)}`); console.log('  ✓ ' + m); pass++; };

console.log('behaviorNode:');
const morph = E.behaviorNode({ name: 'comma_dot', type: 'mod-morph', bindings: ['&kp DOT', '&kp COMMA'], mods: ['MOD_LSFT', 'MOD_RSFT'] });
ok(/comma_dot:\s*comma_dot\s*\{/.test(morph), 'mod-morph node has label: name {');
ok(morph.includes('compatible = "zmk,behavior-mod-morph";'), 'mod-morph compatible string');
ok(morph.includes('#binding-cells = <0>;'), 'mod-morph #binding-cells <0>');
ok(morph.includes('bindings = <&kp DOT>, <&kp COMMA>;'), 'mod-morph bindings');
ok(morph.includes('mods = <(MOD_LSFT|MOD_RSFT)>;'), 'mod-morph mods OR-combined');
const ht = E.behaviorNode({ name: 'hm', type: 'hold-tap', bindings: ['&kp', '&kp'], flavor: 'balanced', tappingTermMs: 180 });
ok(ht.includes('#binding-cells = <2>;') && ht.includes('flavor = "balanced";') && ht.includes('tapping-term-ms = <180>;'), 'hold-tap props');

console.log('addBehavior - into existing behaviors{}:');
const WITH = `/ {
    behaviors {
        existing: existing {
            compatible = "zmk,behavior-mod-morph";
            #binding-cells = <0>;
            bindings = <&kp A>, <&kp B>;
            mods = <(MOD_LSFT)>;
        };
    };

    keymap {
        compatible = "zmk,keymap";
        default_layer { bindings = <&kp Q &kp W &kp E>; };
    };
};
`;
const m1 = E.parseKeymap(WITH);
const spec1 = { name: 'comma_dot', type: 'mod-morph', bindings: ['&kp DOT', '&kp COMMA'], mods: ['MOD_LSFT', 'MOD_RSFT'] };
const out1 = E.addBehavior(m1, spec1);
ok(out1.includes('comma_dot: comma_dot {'), 'new node present');
ok(out1.indexOf('comma_dot') < out1.indexOf('keymap {'), 'inserted inside behaviors{} (before keymap)');
ok(out1.includes('existing: existing {'), 'existing behaviour preserved');
eq(E.parseKeymap(out1).layers.length, 1, 'keymap layers unaffected (still 1)');
eq(E.parseKeymap(out1).layers[0].tokens.length, 3, 'layer key count unaffected (3)');
// round-trip: addBehavior only INSERTS - removing the inserted node yields the original.
eq(out1.replace(E.behaviorNode(spec1) + '\n', ''), WITH, 'pure insertion - original text preserved exactly');

console.log('addBehavior - when no behaviors{} exists (create one in root):');
const WITHOUT = `/ {
    keymap {
        compatible = "zmk,keymap";
        default_layer { bindings = <&kp Q &kp W &kp E>; };
    };
};
`;
const m2 = E.parseKeymap(WITHOUT);
const out2 = E.addBehavior(m2, { name: 'ht', type: 'hold-tap', bindings: ['&kp', '&kp'] });
ok(/behaviors\s*\{/.test(out2), 'behaviors{} block created');
ok(out2.includes('ht: ht {'), 'node present in new block');
ok(out2.indexOf('behaviors {') < out2.indexOf('keymap {'), 'behaviors{} created before keymap (root start)');
eq(E.parseKeymap(out2).layers.length, 1, 'keymap still parses after creating behaviors{}');

console.log('behaviorNameError:');
ok(E.behaviorNameError(m1, '1bad'), 'rejects name starting with a number');
ok(E.behaviorNameError(m1, 'has space'), 'rejects name with space');
ok(E.behaviorNameError(m1, 'existing'), 'detects clash with existing label');
eq(E.behaviorNameError(m1, 'comma_dot'), null, 'accepts a fresh valid name');

console.log(`\nALL ${pass} ASSERTIONS PASSED`);
