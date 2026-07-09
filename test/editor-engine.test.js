/* Round-trip-safety tests for the editor backbone. Run: node test/editor-engine.test.js */
const assert = require('assert');
const E = require('../editor-engine.js');

let pass = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); console.log('  ✓ ' + msg); pass++; };
const eq = (a, b, msg) => { assert.strictEqual(a, b, `${msg}\n   expected: ${JSON.stringify(b)}\n   got:      ${JSON.stringify(a)}`); console.log('  ✓ ' + msg); pass++; };

// A realistic raw .keymap: includes, a mod-morph in behaviors{}, a combo, and
// two layers. Note the line comment containing "&kp NOPE" - it must NOT be
// tokenised as a real binding (comment-awareness).
const SRC = `#include <behaviors.dtsi>
#include <dt-bindings/zmk/keys.h>

/ {
    behaviors {
        // period normally, comma when shifted
        dot_comma: dot_comma {
            compatible = "zmk,behavior-mod-morph";
            #binding-cells = <0>;
            bindings = <&kp DOT>, <&kp COMMA>;
            mods = <(MOD_LSFT|MOD_RSFT)>;
        };
    };

    combos {
        compatible = "zmk,combos";
        combo_esc {
            timeout-ms = <50>;
            key-positions = <0 1>;
            bindings = <&kp ESC>;
        };
    };

    keymap {
        compatible = "zmk,keymap";

        default_layer {
            bindings = <
                &kp Q &kp W &kp E &kp R &kp T   // top row &kp NOPE
                &kp A &kp S &kp D &kp F &kp G    // home row
            >;
        };

        lower_layer {
            bindings = <
                &kp N1 &kp N2 &kp N3 &kp N4 &kp N5
                &trans &trans &dot_comma &trans &mo 2
            >;
        };
    };
};
`;

console.log('parse:');
const model = E.parseKeymap(SRC);
eq(model.layers.length, 2, 'finds exactly 2 layers (behaviors{}/combos{} bindings excluded)');
eq(model.layers[0].name, 'default_layer', 'layer 0 name');
eq(model.layers[1].name, 'lower_layer', 'layer 1 name');
eq(model.layers[0].displayName, 'Default', 'layer 0 display name');
eq(model.layers[0].tokens.length, 10, 'default layer has 10 keys (comment "&kp NOPE" ignored)');
eq(model.layers[1].tokens.length, 10, 'lower layer has 10 keys');
eq(E.layerBindings(model, 0)[2], '&kp E', 'key index 2 on default is "&kp E"');
eq(E.layerBindings(model, 1)[7], '&dot_comma', 'key index 7 on lower is the mod-morph');

console.log('edit (splice one token):');
const edited = E.setBinding(model, 0, 2, '&kp ESC');
const v = E.validateSetBinding(model, edited, 0, 2, '&kp ESC');
ok(v.ok, 'validation passes: ' + (v.errors.join('; ') || 'no errors'));

const after = E.parseKeymap(edited);
eq(E.layerBindings(after, 0)[2], '&kp ESC', 'target key is now "&kp ESC"');
eq(E.layerBindings(after, 0)[3], '&kp R', 'neighbour key 3 unchanged ("&kp R")');
eq(E.layerBindings(after, 0)[1], '&kp W', 'neighbour key 1 unchanged ("&kp W")');
eq(after.layers[1].tokens.map(t => t.text).join(' '),
   model.layers[1].tokens.map(t => t.text).join(' '), 'lower layer completely unchanged');

console.log('everything outside the edited token is byte-identical:');
const slice = (s, re) => { const m = s.match(re); return m ? m[0] : null; };
const behRe = /behaviors\s*\{[\s\S]*?\n {4}\};/;
eq(slice(edited, behRe), slice(SRC, behRe), 'behaviors{} block byte-identical');
const comboRe = /combos\s*\{[\s\S]*?\n {4}\};/;
eq(slice(edited, comboRe), slice(SRC, comboRe), 'combos{} block byte-identical');
ok(edited.includes('// top row &kp NOPE'), 'inline comment preserved');
ok(edited.includes('// home row'), 'home-row comment preserved');
ok(edited.includes('#include <dt-bindings/zmk/keys.h>'), '#include lines preserved');
// Only difference between SRC and edited is the single token's span. Reconstruct
// from the recorded offsets (NOT String.replace, which would hit the identical
// "&kp ESC" already present in the combo block).
const t = model.layers[0].tokens[2];
eq(SRC.slice(0, t.start) + '&kp ESC' + SRC.slice(t.end), edited,
   'edited file == original with ONLY the target token span swapped');

console.log('round-trip (set back to original value restores file exactly):');
const afterModel = E.parseKeymap(edited);
const restored = E.setBinding(afterModel, 0, 2, '&kp E');
eq(restored, SRC, 'restoring the original binding yields byte-identical original');

console.log('undo / redo:');
const h = new E.History(SRC);
h.push(edited);
ok(h.canUndo() && !h.canRedo(), 'can undo, cannot redo after one edit');
eq(h.undo(), SRC, 'undo returns the original text');
ok(h.canRedo(), 'can redo after undo');
eq(h.redo(), edited, 'redo returns the edited text');

console.log(`\nALL ${pass} ASSERTIONS PASSED`);
