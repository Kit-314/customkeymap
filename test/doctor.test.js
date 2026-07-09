/* Tests for the Keymap Doctor. Run: node test/doctor.test.js
 * Each fixture reproduces a real incident (see comments). */
const assert = require('assert');
const D = require('../doctor.js');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m}\n  exp: ${JSON.stringify(b)}\n  got: ${JSON.stringify(a)}`); console.log('  ✓ ' + m); pass++; };

const find = (fs, id) => fs.filter(f => f.id === id);

// fixture: the FlavioMili case - adjacent-key combos with no idle gate
// combo_esc on Q+W (positions 0+1, same row, adjacent), no require-prior-idle-ms.
// combo_gated is identical but gated - must NOT be flagged.
// combo_vertical spans rows - must NOT be flagged by the rollover rule.
const FLAVIO = `/ {
    combos {
        compatible = "zmk,combos";
        combo_esc {
            timeout-ms = <50>;
            key-positions = <0 1>;
            bindings = <&kp ESC>;
        };
        combo_gated {
            timeout-ms = <50>;
            require-prior-idle-ms = <125>;
            key-positions = <2 3>;
            bindings = <&kp TAB>;
        };
        combo_vertical {
            timeout-ms = <50>;
            key-positions = <0 6>;
            bindings = <&kp RET>;
        };
    };
    keymap {
        compatible = "zmk,keymap";
        base_layer {
            bindings = <
&kp Q &kp W &kp E &kp R &kp T &kp Y
&kp A &kp S &kp D &kp F &kp G &kp H
            >;
        };
    };
};`;

console.log('combo rules:');
{
  const fs = D.diagnose(FLAVIO);
  eq(find(fs, 'combo-rollover').length, 1, 'ungated adjacent same-row combo flagged once');
  ok(find(fs, 'combo-rollover')[0].title.includes('combo_esc'), 'the flag names the offending combo');
  ok(find(fs, 'combo-rollover')[0].severity === 'warn', 'rollover is a warning');
}

// out-of-range combo positions + duplicate combos
const COMBO_RANGE = `/ {
    combos {
        compatible = "zmk,combos";
        c_bad { key-positions = <40 41>; bindings = <&kp ESC>; };
        c_one { key-positions = <0 2>; bindings = <&kp TAB>; };
        c_two { key-positions = <0 2>; bindings = <&kp RET>; };
    };
    keymap { compatible = "zmk,keymap";
        base { bindings = <
&kp Q &kp W &kp E &kp R &kp T &kp Y
        >; };
    };
};`;
{
  const fs = D.diagnose(COMBO_RANGE);
  eq(find(fs, 'combo-out-of-range').length, 1, 'combo positions beyond the board are an error');
  eq(find(fs, 'combo-out-of-range')[0].severity, 'error', '…with error severity');
  eq(find(fs, 'combo-duplicate').length, 1, 'identical combos flagged as duplicates');
}

// layer graph rules
// layer 2 unreachable; layer 3 referenced but missing (out of range);
// layer 1 is a &tog target whose only exit is... nothing -> trap.
const LAYERS = `/ {
    keymap {
        compatible = "zmk,keymap";
        base {
            bindings = <
&tog 1 &kp W &kp E &kp R &kp T &mo 4
            >;
        };
        stuck {
            bindings = <
&kp N1 &kp N2 &kp N3 &kp N4 &kp N5 &kp N6
            >;
        };
        orphan {
            bindings = <
&kp A &kp B &kp C &kp D &kp E &kp F
            >;
        };
    };
};`;
console.log('layer rules:');
{
  const fs = D.diagnose(LAYERS);
  eq(find(fs, 'layer-out-of-range').length, 1, '&mo 4 with only 3 layers is an error');
  eq(find(fs, 'layer-unreachable').length, 1, 'orphan layer flagged');
  ok(find(fs, 'layer-unreachable')[0].title.includes('orphan'), 'unreachable flag names the layer');
  eq(find(fs, 'layer-trap').length, 1, '&tog into a layer with no way out is an error');
  ok(find(fs, 'layer-trap')[0].title.toLowerCase().includes('stuck'), 'trap names the layer');
}

// a tog layer WITH an exit must not be flagged; trans resolving to an exit counts
const LAYERS_OK = `/ {
    keymap {
        compatible = "zmk,keymap";
        base {
            bindings = <
&tog 1 &kp W &kp E &kp R &kp T &kp Y
            >;
        };
        navx {
            bindings = <
&trans &kp N2 &kp N3 &kp N4 &kp N5 &kp N6
            >;
        };
    };
};`;
{
  const fs = D.diagnose(LAYERS_OK);
  eq(find(fs, 'layer-trap').length, 0, 'tog layer whose &trans falls through to the &tog key is not a trap');
}

// transparency rules. Position 0 is used on the top layer, so its base &trans
// and mid dead-fall are real findings. Position 6 is &trans on every layer:
// intentionally unused (snapped-off column pattern) and must NOT be reported.
const TRANS = `/ {
    keymap {
        compatible = "zmk,keymap";
        base {
            bindings = <
&trans &kp W &kp E &kp R &kp T &mo 1 &trans
            >;
        };
        mid {
            bindings = <
&trans &trans &kp E &kp R &kp T &trans &trans
            >;
        };
        top {
            bindings = <
&kp Q &kp W &kp E &kp R &kp T &trans &trans
            >;
        };
    };
};`;
console.log('transparency rules:');
{
  const fs = D.diagnose(TRANS);
  const base = find(fs, 'trans-on-base');
  eq(base.length, 1, '&trans on base layer flagged when the position is used elsewhere');
  ok(base[0].title.includes('position 0') && !base[0].title.includes('6'), 'never-used position 6 suppressed from trans-on-base');
  const dead = find(fs, 'trans-to-nothing');
  eq(dead.length, 1, 'fall-through-to-nothing flagged');
  ok(dead[0].title.includes('1 '), 'only mid pos 0 is dead - pos 1 resolves to W, pos 6 never used anywhere');
}

// noise suppression: 3+key rollover and subset overlaps are deliberate patterns
const NOISE = `/ {
    combos {
        compatible = "zmk,combos";
        three { bindings = <&kp A>; key-positions = <0 1 2>; };
        sub   { bindings = <&kp B>; key-positions = <0 1 2 3 4>; };
        part  { bindings = <&kp C>; key-positions = <1 2 5>; };
        two   { bindings = <&kp D>; key-positions = <7 8>; };
    };
    keymap {
        compatible = "zmk,keymap";
        base {
            bindings = <
&kp Q &kp W &kp E &kp R &kp T &kp Y &kp U &kp I &kp O &kp P
            >;
        };
    };
};`;
console.log('noise suppression:');
{
  const fs = D.diagnose(NOISE);
  const roll = find(fs, 'combo-rollover');
  eq(roll.length, 1, 'only the 2-key adjacent combo is a rollover risk; 3+key combos are silent');
  ok(roll[0].title.includes('two'), 'the 2-key combo is the one flagged');
  const ov = find(fs, 'combo-overlap');
  ok(ov.every(f=>f.title.includes('part')), 'subset overlaps (three inside sub, two inside sub) are silent; only partial overlaps via part reported');
  eq(ov.length, 2, 'part overlaps three and sub without being a subset of either');
}

// undefined behaviours
const UNDEF = `/ {
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
        base {
            bindings = <
&morph &ghost_beh &kp E &kp R &kp T &kp Y
            >;
        };
    };
};`;
console.log('behaviour rules:');
{
  const fs = D.diagnose(UNDEF);
  eq(find(fs, 'behavior-undefined').length, 1, 'one undefined behaviour found');
  ok(find(fs, 'behavior-undefined')[0].title.includes('ghost_beh'), 'names the ghost');
  ok(!fs.some(f => f.id === 'behavior-undefined' && f.title.includes('morph')), 'defined morph not flagged');
}

// hold-tap defaults
const HT = `/ {
    behaviors {
        hrm: hrm {
            compatible = "zmk,behavior-hold-tap";
            #binding-cells = <2>;
            bindings = <&kp>, <&kp>;
        };
        tuned: tuned {
            compatible = "zmk,behavior-hold-tap";
            #binding-cells = <2>;
            tapping-term-ms = <280>;
            flavor = "balanced";
            bindings = <&kp>, <&kp>;
        };
    };
    keymap { compatible = "zmk,keymap";
        base { bindings = <
&hrm LGUI A &kp W &kp E &kp R &kp T &kp Y
        >; };
    };
};`;
{
  const fs = D.diagnose(HT);
  eq(find(fs, 'holdtap-defaults').length, 1, 'untuned hold-tap flagged, tuned one not');
  ok(find(fs, 'holdtap-defaults')[0].title.includes('hrm'), 'names the behaviour');
}

// clean keymap stays clean
const CLEAN = `/ {
    keymap {
        compatible = "zmk,keymap";
        base {
            bindings = <
&kp Q &kp W &kp E &kp R &kp T &mo 1
            >;
        };
        num {
            bindings = <
&kp N1 &kp N2 &kp N3 &kp N4 &kp N5 &trans
            >;
        };
    };
};`;
console.log('clean keymap:');
{
  const fs = D.diagnose(CLEAN);
  eq(fs.length, 0, 'no findings on a healthy keymap');
}

console.log(`\nAll ${pass} doctor tests passed.`);

// macro-aware layer graph + scoped-combo exemption (Kit's own keymap shape)
const KITLIKE = `/ {
    macros {
        mouse_enter: mouse_enter {
            compatible = "zmk,behavior-macro";
            bindings = <&rgb_ug RGB_COLOR_HSB(120,100,20)>, <&tog 1>;
        };
        mouse_exit: mouse_exit {
            compatible = "zmk,behavior-macro";
            bindings = <&rgb_ug RGB_COLOR_HSB(0,0,20)>, <&tog 1>;
        };
    };
    combos {
        compatible = "zmk,combos";
        BtSel0 {
            bindings = <&bt BT_SEL 0>;
            key-positions = <1 2 3>;
            timeout-ms = <60>;
            layers = <2>;
        };
        VolUp {
            bindings = <&kp C_VOL_UP>;
            key-positions = <3 4 5>;
            timeout-ms = <60>;
            layers = <0>;
        };
    };
    keymap {
        compatible = "zmk,keymap";
        base {
            bindings = <
&mouse_enter &kp W &kp E &kp R &kp T &mo 2
            >;
        };
        mouse {
            bindings = <
&mouse_exit &kp N2 &kp N3 &kp N4 &kp N5 &kp N6
            >;
        };
        lower {
            bindings = <
&kp A &kp B &kp C &kp D &kp E &kp F
            >;
        };
    };
};`;
console.log('macro-aware + scope-aware rules (Kit-shaped keymap):');
{
  const fs = D.diagnose(KITLIKE);
  eq(find(fs, 'layer-unreachable').length, 0, 'macro-entered layer is reachable');
  eq(find(fs, 'layer-trap').length, 0, 'macro-based exit (&tog inside mouse_exit) counts as a way out');
  eq(find(fs, 'behavior-undefined').length, 0, 'macros count as defined behaviours');
  const roll = find(fs, 'combo-rollover');
  eq(roll.length, 0, '3-key combos are never flagged (a triple rollover misfire does not happen in real typing)');
}
console.log(`\nAll ${pass} doctor tests passed (incl. macro/scope rules).`);

// combo-driven layer entry/exit (the MouseEnter/MouseExit combo pattern)
const COMBOENTRY = `/ {
    macros {
        m_in: m_in { compatible = "zmk,behavior-macro"; bindings = <&tog 1>; };
        m_out: m_out { compatible = "zmk,behavior-macro"; bindings = <&tog 1>; };
    };
    combos {
        compatible = "zmk,combos";
        Enter1 { key-positions = <0 6>; bindings = <&m_in>; layers = <0>; };
        Exit1  { key-positions = <0 6>; bindings = <&m_out>; layers = <1>; };
    };
    keymap {
        compatible = "zmk,keymap";
        base { bindings = <
&kp Q &kp W &kp E &kp R &kp T &kp Y
&kp A &kp S &kp D &kp F &kp G &kp H
        >; };
        mousey { bindings = <
&kp N1 &kp N2 &kp N3 &kp N4 &kp N5 &kp N6
&kp N7 &kp N8 &kp N9 &kp N0 &kp F1 &kp F2
        >; };
    };
};`;
console.log('combo-driven layer transitions:');
{
  const fs = D.diagnose(COMBOENTRY);
  eq(find(fs, 'layer-unreachable').length, 0, 'layer entered only via a combo-bound macro is reachable');
  eq(find(fs, 'layer-trap').length, 0, 'exit combo scoped to the layer counts as a way out');
}
console.log(`\nAll ${pass} doctor tests passed (incl. combo transitions).`);

// layer key-count consistency (the viviengarcia issue #2 case)
const UNEVEN = `/ {
    behaviors {
        lc_tp_ht: lc_tp_ht {
            compatible = "zmk,behavior-hold-tap";
            #binding-cells = <2>;
            bindings = <&kp>, <&mo>;
        };
    };
    keymap {
        compatible = "zmk,keymap";
        base {
            bindings = <
&kp Q &kp W &kp E &kp R &kp T &kp Y
&kp A &kp S &kp D &kp F &kp G &kp H
            >;
        };
        sym {
            bindings = <
&kp N1 &kp N2 &kp N3 &kp N4 &kp N5 &kp N6
&kp N7 &kp N8 &kp N9 &kp N0 &kp MINUS
            >;
        };
    };
};`;
console.log('layer key-count rule:');
{
  const fs = D.diagnose(UNEVEN);
  const lc = find(fs, 'layer-key-count');
  eq(lc.length, 1, 'uneven layer counts flagged (sym has 11, base has 12)');
  ok(lc[0].title.includes('sym'), 'names the odd layer');
}
{
  const even = D.diagnose(CLEAN);
  eq(find(even, 'layer-key-count').length, 0, 'consistent layers not flagged');
}
console.log(`\nAll ${pass} doctor tests passed (incl. layer key-count).`);

// custom hold-tap / layer-tap recognised as a layer switch (no false unreachable)
const CUSTOMLT = `/ {
    behaviors {
        lc_tp_ht: lc_tp_ht {
            compatible = "zmk,behavior-hold-tap";
            flavor = "tap-preferred";
            bindings = <&kp>, <&mo>;
        };
    };
    keymap {
        compatible = "zmk,keymap";
        base {
            bindings = <
&kp Q &kp W &kp E &kp R &kp T &kp Y
&lc_tp_ht 1 SPC &kp A &kp S &kp D &kp F &kp G
            >;
        };
        navig {
            bindings = <
&kp N1 &kp N2 &kp N3 &kp N4 &kp N5 &kp N6
&trans &kp N7 &kp N8 &kp N9 &kp N0 &kp MINUS
            >;
        };
    };
};`;
console.log('custom layer-tap reachability:');
{
  const fs = D.diagnose(CUSTOMLT);
  eq(find(fs, 'layer-unreachable').length, 0, 'layer reached via a custom hold-tap (&lc_tp_ht 1 …) is NOT flagged unreachable');
  eq(find(fs, 'layer-trap').length, 0, 'a custom hold-tap wrapping &mo is momentary - no trap');
}
console.log(`\nAll ${pass} doctor tests passed (incl. custom layer-tap).`);
