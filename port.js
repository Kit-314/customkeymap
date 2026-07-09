/* port.js - cross-board keymap porting.
 *
 * Pure module (node-testable; browser global KeymapPort). Mechanizes the
 * by-hand Corne36 to ErgoQuill port: bindings are mapped between boards by
 * PHYSICAL ROLE (hand, row, column-from-inner; thumbs by distance from the
 * inner position), not by raw index, so a 36-key map lands correctly on a
 * 42-key board and vice versa, with the differences reported instead of
 * silently mangled.
 */
(function(root){
  'use strict';

  // Role tables for the boards the visualizer knows. rows are top to bottom; each
  // row lists binding positions OUTER to INNER for the left hand and INNER to OUTER
  // for the right (i.e. reading order), matching the app's layout tables.
  // Thumbs are listed reading order too; role-wise we index them from INNER.
  const BOARDS = {
    sweep34: { label:'Sweep / Ferris (34)', total:34,
      leftRows:[[0,1,2,3,4],[10,11,12,13,14],[20,21,22,23,24]],
      rightRows:[[5,6,7,8,9],[15,16,17,18,19],[25,26,27,28,29]],
      leftThumb:[30,31], rightThumb:[32,33] },
    corne36: { label:'Corne 5-column (36)', total:36,
      leftRows:[[0,1,2,3,4],[10,11,12,13,14],[20,21,22,23,24]],
      rightRows:[[5,6,7,8,9],[15,16,17,18,19],[25,26,27,28,29]],
      leftThumb:[30,31,32], rightThumb:[33,34,35] },
    corne42: { label:'Corne (42)', total:42,
      leftRows:[[0,1,2,3,4,5],[12,13,14,15,16,17],[24,25,26,27,28,29]],
      rightRows:[[6,7,8,9,10,11],[18,19,20,21,22,23],[30,31,32,33,34,35]],
      leftThumb:[36,37,38], rightThumb:[39,40,41] },
    corne43: { label:'Corne spec layout (43)', total:43,
      leftRows:[[0,1,2,3,4,5],[12,13,14,15,16,17],[24,25,26,27,28,29]],
      rightRows:[[6,7,8,9,10,11],[18,19,20,21,22,23],[30,31,32,33,34,35]],
      leftThumb:[37,38,39], rightThumb:[40,41,42] },
    ergoquill38: { label:'ErgoQuill (38)', total:38, hidden:true, // not publicly available yet
      leftRows:[[0,1,2,3,4],[10,11,12,13,14],[20,21,22,23,24]],
      rightRows:[[5,6,7,8,9],[15,16,17,18,19],[25,26,27,28,29]],
      // L thumbs reading order: above_mid, outer, mid, inner / R: inner, mid, outer, above_mid
      leftThumb:[30,31,32,33], rightThumb:[34,35,36,37],
      // above_mid is an EXTRA role, not part of the inner to outer run
      leftThumbExtra:[30], rightThumbExtra:[37] },
    ergoquill37: { label:'ErgoQuill Joy (37)', total:37, hidden:true,
      leftRows:[[0,1,2,3,4],[10,11,12,13,14],[20,21,22,23,24]],
      rightRows:[[5,6,7,8,9],[15,16,17,18,19],[25,26,27,28,29]],
      leftThumb:[30,31,32], rightThumb:[33,34,35,36],
      rightThumbExtra:[36] },
    // Entries below were derived from each board's canonical firmware definition
    // (ZMK in-tree shield, vendor ZMK config, or the vendor's QMK layout where no
    // ZMK one exists) and cross-checked against the matrix transform. Positions
    // are binding-order indices of the board's standard keymap.
    chocofi36: { label:'Chocofi (36)', total:36,
      // runs the corne shield's five_column_transform, so binding order is
      // identical to a 36-key 5-column Corne
      leftRows:[[0,1,2,3,4],[10,11,12,13,14],[20,21,22,23,24]],
      rightRows:[[5,6,7,8,9],[15,16,17,18,19],[25,26,27,28,29]],
      leftThumb:[30,31,32], rightThumb:[33,34,35] },
    totem38: { label:'Totem (38)', total:38,
      // extra outer pinky key per half sits at the outer end of row 2
      leftRows:[[0,1,2,3,4],[10,11,12,13,14],[20,21,22,23,24,25]],
      rightRows:[[5,6,7,8,9],[15,16,17,18,19],[26,27,28,29,30,31]],
      leftThumb:[32,33,34], rightThumb:[35,36,37] },
    reviung41: { label:'Reviung41 (41)', total:41,
      // unibody: index 38 is the single shared center thumb key
      leftRows:[[0,1,2,3,4,5],[12,13,14,15,16,17],[24,25,26,27,28,29]],
      rightRows:[[6,7,8,9,10,11],[18,19,20,21,22,23],[30,31,32,33,34,35]],
      leftThumb:[36,37], rightThumb:[39,40], leftThumbExtra:[38] },
    piantor: { label:'Piantor (42)', total:42,
      // beekeeb's official layout is LAYOUT_split_3x6_3, binding order
      // identical to Corne 42
      leftRows:[[0,1,2,3,4,5],[12,13,14,15,16,17],[24,25,26,27,28,29]],
      rightRows:[[6,7,8,9,10,11],[18,19,20,21,22,23],[30,31,32,33,34,35]],
      leftThumb:[36,37,38], rightThumb:[39,40,41] },
    kyria50: { label:'Kyria (50)', total:50,
      // the four inner keys inboard of B/N (30,31 left; 32,33 right) are kept
      // out of row 2 so the alpha columns line up with other boards
      leftRows:[[0,1,2,3,4,5],[12,13,14,15,16,17],[24,25,26,27,28,29]],
      rightRows:[[6,7,8,9,10,11],[18,19,20,21,22,23],[34,35,36,37,38,39]],
      leftThumb:[40,41,42,43,44], rightThumb:[45,46,47,48,49],
      leftThumbExtra:[30,31], rightThumbExtra:[32,33] },
    lily58: { label:'Lily58 (58)', total:58, homeRow:2,
      // 42/43 are the inner pair between the hands on row 3
      leftRows:[[0,1,2,3,4,5],[12,13,14,15,16,17],[24,25,26,27,28,29],[36,37,38,39,40,41]],
      rightRows:[[6,7,8,9,10,11],[18,19,20,21,22,23],[30,31,32,33,34,35],[44,45,46,47,48,49]],
      leftThumb:[50,51,52,53], rightThumb:[54,55,56,57],
      leftThumbExtra:[42], rightThumbExtra:[43] },
    sofle: { label:'Sofle (60)', total:60, homeRow:2,
      // same finger grid as Lily58 with 5 thumbs per side; 42/43 inner pair
      leftRows:[[0,1,2,3,4,5],[12,13,14,15,16,17],[24,25,26,27,28,29],[36,37,38,39,40,41]],
      rightRows:[[6,7,8,9,10,11],[18,19,20,21,22,23],[30,31,32,33,34,35],[44,45,46,47,48,49]],
      leftThumb:[50,51,52,53,54], rightThumb:[55,56,57,58,59],
      leftThumbExtra:[42], rightThumbExtra:[43] },
    adv360pro: { label:'Advantage360 Pro (76)', total:76, homeRow:2,
      // rows 0-2 include the inner mod-column key; the thumb home row (the
      // keys the thumbs rest on per Kinesis) is primary, upper mods plus the
      // bottom key are extras
      leftRows:[[0,1,2,3,4,5,6],[14,15,16,17,18,19,20],[28,29,30,31,32,33,34],[46,47,48,49,50,51],[60,61,62,63,64]],
      rightRows:[[7,8,9,10,11,12,13],[21,22,23,24,25,26,27],[39,40,41,42,43,44,45],[54,55,56,57,58,59],[71,72,73,74,75]],
      leftThumb:[65,66,52], leftThumbExtra:[35,36,67],
      rightThumb:[53,69,70], rightThumbExtra:[37,38,68] },
    glove80: { label:'Glove80 (80)', total:80, homeRow:3,
      // lower thumb row is the home row (Backspace/Enter/Space), upper
      // modifier row goes in extras
      leftRows:[[0,1,2,3,4],[10,11,12,13,14,15],[22,23,24,25,26,27],[34,35,36,37,38,39],[46,47,48,49,50,51],[64,65,66,67,68]],
      rightRows:[[5,6,7,8,9],[16,17,18,19,20,21],[28,29,30,31,32,33],[40,41,42,43,44,45],[58,59,60,61,62,63],[75,76,77,78,79]],
      leftThumb:[69,70,71], leftThumbExtra:[52,53,54],
      rightThumb:[72,73,74], rightThumbExtra:[55,56,57] },
    klor44: { label:'KLOR (44)', total:44,
      // one entry covers ALL KLOR forms: ZMK ships a single 44-position
      // transform and the trimmed builds (Konrad 42, Yubitsume 40,
      // Saegewerk 38) leave their absent keys as &none in the same order.
      // 28/29 are the two center keys inboard of the index columns.
      leftRows:[[0,1,2,3,4],[10,11,12,13,14,15],[22,23,24,25,26,27]],
      rightRows:[[5,6,7,8,9],[16,17,18,19,20,21],[30,31,32,33,34,35]],
      leftThumb:[36,37,38,39], rightThumb:[40,41,42,43],
      leftThumbExtra:[28], rightThumbExtra:[29] },
    // Dactyl family: no in-tree ZMK shields exist, so binding order comes from
    // the QMK in-tree LAYOUT definitions (same approach as the Piantor). The
    // Manuform's 2-key inner droop is a short bottom row; the two big
    // thumb-home caps are primary and the 2x2 secondary block is extras.
    dactylManuform4x5: { label:'Dactyl Manuform 4x5 (46)', total:46,
      leftRows:[[0,1,2,3,4],[10,11,12,13,14],[20,21,22,23,24],[30,31]],
      rightRows:[[5,6,7,8,9],[15,16,17,18,19],[25,26,27,28,29],[32,33]],
      leftThumb:[34,35], rightThumb:[36,37],
      leftThumbExtra:[38,39,42,43], rightThumbExtra:[40,41,44,45] },
    dactylManuform4x6: { label:'Dactyl Manuform 4x6 (52)', total:52,
      leftRows:[[0,1,2,3,4,5],[12,13,14,15,16,17],[24,25,26,27,28,29],[36,37]],
      rightRows:[[6,7,8,9,10,11],[18,19,20,21,22,23],[30,31,32,33,34,35],[38,39]],
      leftThumb:[40,41], rightThumb:[42,43],
      leftThumbExtra:[44,45,48,49], rightThumbExtra:[46,47,50,51] },
    dactylManuform5x6: { label:'Dactyl Manuform 5x6 (64)', total:64, homeRow:2,
      leftRows:[[0,1,2,3,4,5],[12,13,14,15,16,17],[24,25,26,27,28,29],[36,37,38,39,40,41],[48,49]],
      rightRows:[[6,7,8,9,10,11],[18,19,20,21,22,23],[30,31,32,33,34,35],[42,43,44,45,46,47],[50,51]],
      leftThumb:[52,53], rightThumb:[54,55],
      leftThumbExtra:[56,57,60,61], rightThumbExtra:[58,59,62,63] },
    dactylManuform6x6: { label:'Dactyl Manuform 6x6 (76)', total:76, homeRow:3,
      leftRows:[[0,1,2,3,4,5],[12,13,14,15,16,17],[24,25,26,27,28,29],[36,37,38,39,40,41],[48,49,50,51,52,53],[60,61]],
      rightRows:[[6,7,8,9,10,11],[18,19,20,21,22,23],[30,31,32,33,34,35],[42,43,44,45,46,47],[54,55,56,57,58,59],[62,63]],
      leftThumb:[64,65], rightThumb:[66,67],
      leftThumbExtra:[68,69,72,73], rightThumbExtra:[70,71,74,75] },
    dactyl70: { label:'Dactyl (70)', total:70, homeRow:2,
      // original Dactyl: LAYOUT lists the whole left hand then the whole
      // right hand (not row-interleaved); y4 partial rows drop the INNER
      // column, so the left one is outer-aligned
      leftRows:[[0,1,2,3,4,5],[6,7,8,9,10,11],[12,13,14,15,16,17],[18,19,20,21,22,23],[24,25,26,27,28]],
      rightRows:[[35,36,37,38,39,40],[41,42,43,44,45,46],[47,48,49,50,51,52],[53,54,55,56,57,58],[59,60,61,62,63]],
      leftThumb:[32,33], rightThumb:[68,69],
      leftThumbExtra:[29,30,31,34], rightThumbExtra:[64,65,66,67] },
  };

  // role string for every position of a board: 'L:r1:c2' (c counted from INNER,
  // so col roles line up between 5-col and 6-col boards), 'LT:0' (thumb, 0 =
  // innermost), 'LTX:0' (extra thumb such as ErgoQuill's above-mid).
  // Rows are anchored at the HOME row (board.homeRow, default 1 for the classic
  // 3-row boards), not the top row: boards with number or function rows above
  // the alphas (Lily58, Glove80, ...) must still land QWERTY on QWERTY when
  // ported to a 3-row board. Row roles are therefore offsets from home and can
  // be negative (rows above home) or positive (rows below).
  function roleMap(board){
    const roles = new Map(); // role -> position
    const place = (role,pos)=>{ if(!roles.has(role)) roles.set(role,pos); };
    const home = board.homeRow!=null ? board.homeRow : 1;
    board.leftRows.forEach((row,r)=>{
      // left rows are OUTER to INNER in reading order: inner col = last element
      row.slice().reverse().forEach((pos,cFromInner)=>place(`L:${r-home}:${cFromInner}`,pos));
    });
    board.rightRows.forEach((row,r)=>{
      // right rows are INNER to OUTER in reading order
      row.forEach((pos,cFromInner)=>place(`R:${r-home}:${cFromInner}`,pos));
    });
    const extras = new Set([...(board.leftThumbExtra||[]), ...(board.rightThumbExtra||[])]);
    const lt=(board.leftThumb||[]).filter(p=>!extras.has(p));
    const rt=(board.rightThumb||[]).filter(p=>!extras.has(p));
    // left thumbs reading order end at the innermost; right thumbs start there
    lt.slice().reverse().forEach((pos,i)=>place(`LT:${i}`,pos));
    rt.forEach((pos,i)=>place(`RT:${i}`,pos));
    (board.leftThumbExtra||[]).forEach((pos,i)=>place(`LTX:${i}`,pos));
    (board.rightThumbExtra||[]).forEach((pos,i)=>place(`RTX:${i}`,pos));
    return roles;
  }

  // mapping between two boards: for every target position, the source position
  // with the same role (or null). Also reports source positions nothing claimed.
  function makeMapping(srcId, dstId){
    const src=BOARDS[srcId], dst=BOARDS[dstId];
    if(!src||!dst) throw new Error('unknown board: '+(src?dstId:srcId));
    const sRoles=roleMap(src), dRoles=roleMap(dst);
    const dstFromSrc=new Array(dst.total).fill(null);
    const claimed=new Set();
    for(const [role,dPos] of dRoles){
      if(sRoles.has(role)){ dstFromSrc[dPos]=sRoles.get(role); claimed.add(sRoles.get(role)); }
    }
    const dropped=[];
    for(let p=0;p<src.total;p++) if(!claimed.has(p)) dropped.push(p);
    const unfilled=[];
    dstFromSrc.forEach((s,d)=>{ if(s==null) unfilled.push(d); });
    return { srcId, dstId, dstFromSrc, dropped, unfilled,
             srcToDst: invert(dstFromSrc, src.total) };
  }
  function invert(dstFromSrc, srcTotal){
    const m=new Array(srcTotal).fill(null);
    dstFromSrc.forEach((s,d)=>{ if(s!=null) m[s]=d; });
    return m;
  }

  // apply a mapping to parsed layers -> new binding arrays (target shape)
  function portLayers(layers, mapping, fill){
    fill = fill || '&trans';
    return layers.map(L=>({
      name: L.name,
      bindings: mapping.dstFromSrc.map(s=> s!=null && L.bindings[s]!=null ? String(L.bindings[s]).trim() : fill),
    }));
  }

  // remap combos through the mapping; combos touching dropped keys are reported
  function portCombos(combos, mapping){
    const kept=[], dropped=[];
    for(const c of (combos||[])){
      const mapped=c.positions.map(p=>mapping.srcToDst[p]);
      if(mapped.some(p=>p==null)) dropped.push(c);
      else kept.push(Object.assign({}, c, {positions:mapped}));
    }
    return {kept, dropped};
  }

  // generate the ported .keymap text. Copies behaviors/macros blocks verbatim
  // from the source text (they're position-independent), rebuilds combos with
  // remapped positions, and emits the mapped layers.
  function generateKeymap(opts){
    const { layers, combos, srcText, mapping, perRow } = opts;
    const cols = perRow || 10;
    const fmt = arr => { let s=''; for(let i=0;i<arr.length;i+=cols) s+='\n                '+arr.slice(i,i+cols).join('  '); return s+'\n            '; };
    const grab = name => {
      const m=String(srcText||'').match(new RegExp('\\b'+name+'\\s*\\{','m'));
      if(!m) return '';
      let depth=1,i=m.index+m[0].length;
      const t=String(srcText);
      while(i<t.length&&depth>0){ const ch=t[i++]; if(ch==='{')depth++; else if(ch==='}')depth--; }
      return '    '+t.slice(m.index, i).trim()+(t[i]===';'?';':';')+'\n\n';
    };
    let combosBlock='';
    if(combos && combos.length){
      combosBlock = '    combos {\n        compatible = "zmk,combos";\n'
        + combos.map(c=>'        '+c.name+' {\n'
            + (c.timeout!=null?'            timeout-ms = <'+c.timeout+'>;\n':'')
            + (c.idle!=null?'            require-prior-idle-ms = <'+c.idle+'>;\n':'')
            + '            key-positions = <'+c.positions.join(' ')+'>;\n'
            + '            bindings = <'+c.binding+'>;\n'
            + (c.layers?'            layers = <'+c.layers.join(' ')+'>;\n':'')
            + '        };').join('\n')
        + '\n    };\n\n';
    }
    return '/*\n * Ported with customkeymap: '+BOARDS[mapping.srcId].label+' -> '+BOARDS[mapping.dstId].label+'\n'
      + ' * Unfilled target keys are '+(opts.fill||'&trans')+'; review the port report for dropped bindings.\n */\n'
      + '#include <behaviors.dtsi>\n#include <dt-bindings/zmk/keys.h>\n#include <dt-bindings/zmk/bt.h>\n\n'
      + '/ {\n'
      + grab('behaviors') + grab('macros') + combosBlock
      + '    keymap {\n        compatible = "zmk,keymap";\n\n'
      + layers.map(L=>'        '+L.name.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')+'_layer {\n            bindings = <'+fmt(L.bindings)+'>;\n        };').join('\n\n')
      + '\n    };\n};\n';
  }

  const api={ BOARDS, makeMapping, portLayers, portCombos, generateKeymap, _internal:{ roleMap } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.KeymapPort = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
