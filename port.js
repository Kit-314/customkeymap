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
    corne36: { label:'36-key split (Corne 36)', total:36,
      leftRows:[[0,1,2,3,4],[10,11,12,13,14],[20,21,22,23,24]],
      rightRows:[[5,6,7,8,9],[15,16,17,18,19],[25,26,27,28,29]],
      leftThumb:[30,31,32], rightThumb:[33,34,35] },
    corne42: { label:'Corne (42)', total:42,
      leftRows:[[0,1,2,3,4,5],[12,13,14,15,16,17],[24,25,26,27,28,29]],
      rightRows:[[6,7,8,9,10,11],[18,19,20,21,22,23],[30,31,32,33,34,35]],
      leftThumb:[36,37,38], rightThumb:[39,40,41] },
    corne43: { label:'Corne (43, spec layout)', total:43,
      leftRows:[[0,1,2,3,4,5],[12,13,14,15,16,17],[24,25,26,27,28,29]],
      rightRows:[[6,7,8,9,10,11],[18,19,20,21,22,23],[30,31,32,33,34,35]],
      leftThumb:[37,38,39], rightThumb:[40,41,42] },
    ergoquill38: { label:'ErgoQuill (38)', total:38,
      leftRows:[[0,1,2,3,4],[10,11,12,13,14],[20,21,22,23,24]],
      rightRows:[[5,6,7,8,9],[15,16,17,18,19],[25,26,27,28,29]],
      // L thumbs reading order: above_mid, outer, mid, inner / R: inner, mid, outer, above_mid
      leftThumb:[30,31,32,33], rightThumb:[34,35,36,37],
      // above_mid is an EXTRA role, not part of the inner to outer run
      leftThumbExtra:[30], rightThumbExtra:[37] },
    ergoquill37: { label:'ErgoQuill Joy (37)', total:37,
      leftRows:[[0,1,2,3,4],[10,11,12,13,14],[20,21,22,23,24]],
      rightRows:[[5,6,7,8,9],[15,16,17,18,19],[25,26,27,28,29]],
      leftThumb:[30,31,32], rightThumb:[33,34,35,36],
      rightThumbExtra:[36] },
  };

  // role string for every position of a board: 'L:r1:c2' (c counted from INNER,
  // so col roles line up between 5-col and 6-col boards), 'LT:0' (thumb, 0 =
  // innermost), 'LTX:0' (extra thumb such as ErgoQuill's above-mid).
  function roleMap(board){
    const roles = new Map(); // role -> position
    const place = (role,pos)=>{ if(!roles.has(role)) roles.set(role,pos); };
    board.leftRows.forEach((row,r)=>{
      // left rows are OUTER to INNER in reading order: inner col = last element
      row.slice().reverse().forEach((pos,cFromInner)=>place(`L:${r}:${cFromInner}`,pos));
    });
    board.rightRows.forEach((row,r)=>{
      // right rows are INNER to OUTER in reading order
      row.forEach((pos,cFromInner)=>place(`R:${r}:${cFromInner}`,pos));
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
