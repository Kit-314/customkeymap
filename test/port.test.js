/* Tests for the porting module. Run: node test/port.test.js */
const assert = require('assert');
const P = require('../port.js');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const eq = (a, b, m) => { assert.deepStrictEqual(a, b, `${m}\n  exp: ${JSON.stringify(b)}\n  got: ${JSON.stringify(a)}`); console.log('  ✓ ' + m); pass++; };

console.log('role mapping, 36 → ErgoQuill 38 (the port we did by hand):');
{
  const m = P.makeMapping('corne36', 'ergoquill38');
  // identical 3x5 alpha block: positions map 1:1
  eq(m.dstFromSrc.slice(0, 30), [...Array(30).keys()], 'alpha block maps straight across');
  // corne36 left thumbs [30,31,32]: innermost = 32 maps to EQ inner = 33
  eq(m.dstFromSrc[33], 32, 'left inner thumb → left inner thumb');
  eq(m.dstFromSrc[32], 31, 'left mid thumb follows');
  eq(m.dstFromSrc[31], 30, 'left outer thumb follows');
  eq(m.dstFromSrc[30], null, 'ErgoQuill above-mid thumb is new (unfilled)');
  eq(m.dstFromSrc[34], 33, 'right inner thumb → right inner thumb');
  eq(m.unfilled, [30, 37], 'exactly the two above-mid thumbs are unfilled');
  eq(m.dropped, [], 'nothing from the 36 is dropped');
}

console.log('role mapping, 42 → 36 (outer column drops):');
{
  const m = P.makeMapping('corne42', 'corne36');
  // 42 left rows are [0..5] outer to inner; inner 5 land on the 36's row
  eq(m.dstFromSrc.slice(0, 5), [1, 2, 3, 4, 5], 'left row 0 keeps the inner five');
  eq(m.dropped, [0, 6 + 5, 12, 18 + 5, 24, 30 + 5].sort((a,b)=>a-b), 'both outer columns dropped (6 keys)');
  eq(m.unfilled, [], 'every 36 position is filled from the 42');
}

console.log('porting layers + combos:');
{
  const m = P.makeMapping('corne36', 'ergoquill38');
  const layers = [{ name: 'Base', bindings: Array.from({length:36}, (_,i)=>'&kp K'+i) }];
  const ported = P.portLayers(layers, m, '&trans');
  eq(ported[0].bindings.length, 38, 'target has 38 bindings');
  eq(ported[0].bindings[33], '&kp K32', 'inner thumb binding travelled');
  eq(ported[0].bindings[30], '&trans', 'new thumb filled with &trans');

  const combos = [
    { name: 'c_ok', positions: [1, 2], binding: '&kp ESC', timeout: 50, idle: 125, layers: null },
    { name: 'c_dead', positions: [0, 35], binding: '&kp TAB', timeout: 50, idle: null, layers: null },
  ];
  const r = P.portCombos(combos, m);
  eq(r.kept.length, 2, 'both combos survive 36→38 (no source keys dropped)');
  eq(r.kept[0].positions, [1, 2], 'combo positions remapped');
  eq(r.kept[1].positions[1], 36, 'right outer thumb (36-key pos 35, role RT:2) lands on ErgoQuill pos 36');

  const m2 = P.makeMapping('corne42', 'corne36');
  const combos2 = [{ name: 'c_outer', positions: [0, 1], binding: '&kp ESC', timeout: 50, idle: null, layers: null }];
  const r2 = P.portCombos(combos2, m2);
  eq(r2.dropped.length, 1, 'combo on a dropped outer-column key is reported, not mangled');
}

console.log('keymap generation:');
{
  const m = P.makeMapping('corne36', 'ergoquill38');
  const layers = P.portLayers([{ name: 'Base', bindings: Array.from({length:36}, ()=>'&kp A') }], m);
  const src = `/ { behaviors { dc: dot_comma { compatible = "zmk,behavior-mod-morph"; #binding-cells = <0>; bindings = <&kp DOT>, <&kp COMMA>; mods = <(MOD_LSFT)>; }; }; };`;
  const out = P.generateKeymap({ layers, combos: [], srcText: src, mapping: m });
  ok(out.includes('zmk,keymap'), 'emits a keymap node');
  ok(out.includes('dot_comma'), 'behaviors block copied across verbatim');
  ok(out.includes('base_layer'), 'layer name normalised to devicetree style');
  const kmPart = out.slice(out.indexOf('keymap {'));   // skip the header comment, which mentions &trans
  eq((kmPart.match(/&kp A/g) || []).length, 36, 'all 36 source bindings present');
  eq((kmPart.match(/&trans/g) || []).length, 2, 'two unfilled thumbs emitted as &trans');
}

console.log(`\nAll ${pass} port tests passed.`);
