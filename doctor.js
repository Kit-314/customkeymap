/* doctor.js - Keymap Doctor: static analysis for ZMK keymaps.
 *
 * Pure and DOM-free (same contract as editor-engine.js) so it runs under node
 * for tests and in the browser as window.KeymapDoctor.
 *
 * Entry point:
 *   diagnose(text, layers) -> [{ id, severity, title, detail, fix? }]
 *     text   - the (preprocessed) keymap source
 *     layers - parsed layers [{name, bindings:[...], rows:[[tok,...],...]}]
 *              (pass the app's parse; tests use the internal fallback parser)
 *
 * severity: 'error' (will misbehave / won't build) | 'warn' (likely to bite)
 *         | 'info' (worth knowing).
 *
 * Every rule here traces to a real incident - see test/doctor.test.js for the
 * reproductions. The flagship rule (combo-rollover) is the FlavioMili case:
 * combos on adjacent alpha keys without require-prior-idle-ms read as "lag".
 */
(function(root){
  'use strict';

  // tiny devicetree helpers
  function stripComments(t){
    return t.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  }
  // All child blocks named `word {` inside every `outer { }` block in the text.
  // Returns [{name, label, body}] - name is the node name, label the "lbl:" prefix.
  function childBlocks(text, outerName){
    const out=[];
    const re=new RegExp('\\b'+outerName+'\\s*\\{','g');
    let m;
    while((m=re.exec(text))!==null){
      let depth=1, i=m.index+m[0].length;
      while(i<text.length && depth>0){ const c=text[i++]; if(c==='{')depth++; else if(c==='}')depth--; }
      const block=text.slice(m.index+m[0].length, i-1);
      const cRe=/(?:(\w+)\s*:\s*)?([\w-]+)\s*\{/g;
      let cm;
      while((cm=cRe.exec(block))!==null){
        if(cm[2]==='compatible') continue;
        let d=1, j=cm.index+cm[0].length;
        while(j<block.length && d>0){ const c=block[j++]; if(c==='{')d++; else if(c==='}')d--; }
        out.push({label:cm[1]||null, name:cm[2], body:block.slice(cm.index+cm[0].length, j-1)});
        cRe.lastIndex=j;
      }
    }
    return out;
  }
  const propNum = (body,name)=>{ const m=body.match(new RegExp('\\b'+name+'\\s*=\\s*<([^>]+)>')); return m?parseInt(m[1].trim(),10):null; };
  const propNums= (body,name)=>{ const m=body.match(new RegExp('\\b'+name+'\\s*=\\s*<([^>]+)>')); return m?m[1].trim().split(/\s+/).map(Number):null; };
  const propStr = (body,name)=>{ const m=body.match(new RegExp('\\b'+name+'\\s*=\\s*"([^"]+)"')); return m?m[1]:null; };
  const hasProp = (body,name)=>new RegExp('\\b'+name+'\\s*[=;]').test(body);

  // fallback layer parser (tests / standalone use)
  function fallbackLayers(text){
    const layers=[];
    const km=text.match(/\bkeymap\s*\{/);
    if(!km) return layers;
    let depth=1,i=km.index+km[0].length;
    while(i<text.length&&depth>0){ const c=text[i++]; if(c==='{')depth++; else if(c==='}')depth--; }
    const block=text.slice(km.index+km[0].length,i-1);
    const cRe=/(\w+)\s*\{/g; let cm;
    while((cm=cRe.exec(block))!==null){
      if(cm[1]==='compatible') continue;
      let d=1,j=cm.index+cm[0].length;
      while(j<block.length&&d>0){ const c=block[j++]; if(c==='{')d++; else if(c==='}')d--; }
      const body=block.slice(cm.index+cm[0].length,j-1);
      const bm=body.match(/bindings\s*=\s*<([\s\S]*?)>\s*;/);
      if(!bm) continue;
      const rows=bm[1].split('\n').map(l=>l.match(/&[\w-]+(?:\s+[\w()|!+-]+)*/g)||[]).filter(r=>r.length);
      layers.push({name:cm[1], bindings:rows.flat(), rows});
      cRe.lastIndex=j;
    }
    return layers;
  }

  // shared lookups
  // Behaviours ZMK ships with (anything else must be defined in the keymap).
  const BUILTIN = new Set(['kp','mo','lt','to','tog','sl','sk','mt','trans','none',
    'bootloader','sys_reset','reset','bt','out','rgb_ug','ext_power','caps_word',
    'key_repeat','gresc','grave_escape','mkp','mmv','msc','msc_scrl','mwh','studio_unlock',
    'soft_off','kt','key_toggle','sensor_rotate','inc_dec_kp','backlight','bl']);

  // positions of each row as index ranges, derived from the source's own line
  // structure (works for any board, no layout table needed)
  function rowIndexRanges(layer){
    const ranges=[]; let start=0;
    for(const row of (layer.rows||[])){ ranges.push([start, start+row.length]); start+=row.length; }
    return ranges;
  }
  function sameRowAdjacent(positions, ranges){
    // true when every combo member sits in one row and the members are consecutive
    const sorted=positions.slice().sort((a,b)=>a-b);
    const row=ranges.find(([s,e])=>sorted[0]>=s && sorted[0]<e);
    if(!row) return false;
    if(!sorted.every(p=>p>=row[0]&&p<row[1])) return false;
    for(let i=1;i<sorted.length;i++) if(sorted[i]!==sorted[i-1]+1) return false;
    return true;
  }

  // every `&behavior arg arg` token in a binding list
  function bindingRefs(bindings){
    const refs=[];
    for(let i=0;i<bindings.length;i++){
      const m=String(bindings[i]).trim().match(/^&([\w-]+)/);
      if(m) refs.push({pos:i, name:m[1], raw:String(bindings[i]).trim()});
    }
    return refs;
  }
  // layer references inside a binding string: &mo N, &lt N X, &to N, &tog N, &sl N
  function layerRefs(raw){
    const out=[];
    const m=raw.match(/^&(mo|lt|to|tog|sl)\s+(\d+)/);
    if(m) out.push({kind:m[1], layer:+m[2]});
    return out;
  }

  // the rules
  function diagnose(text, layersIn){
    const src=stripComments(String(text||''));
    const layers=(layersIn&&layersIn.length)?layersIn:fallbackLayers(src);
    const findings=[];
    if(!layers.length) return findings;
    // layer key-count consistency
    // A keymap has ONE physical layout, so every layer must have the same number
    // of bindings. An odd layer is either an author who dropped/added a key, or a
    // binding the parser mis-split - both render with the wrong geometry. (This is
    // the viviengarcia/zmk-config case: Default 39, Diacs 36, the rest 38.)
    const counts=layers.map(l=>l.bindings.length);
    const freq=new Map(); counts.forEach(n=>freq.set(n,(freq.get(n)||0)+1));
    let modal=counts[0],modalC=0;
    for(const [n,c] of freq) if(c>modalC){ modal=n; modalC=c; }
    const odd=layers.map((l,i)=>({i,name:l.name||('layer '+i),n:counts[i]})).filter(x=>x.n!==modal);
    if(odd.length) findings.push({
      id:'layer-key-count', severity:'warn',
      title:`Layers don't all have the same key count - ${odd.map(o=>`“${o.name}” has ${o.n}`).join(', ')}, the rest have ${modal}`,
      detail:'A keyboard has one physical layout, so every layer should hold the same number of bindings. A layer with a different count usually means a key was dropped or added in that layer, or a binding (often a hold-tap whose parameter is itself a &reference) was mis-counted - and it forces that layer to render with the wrong shape.',
      fix:`Bring every layer to ${modal} bindings: add the missing key(s) to the short layers / remove the extra from the long ones.`,
    });
    const nKeys=modal;
    const layerName=i=>(layers[i]&&layers[i].name)?layers[i].name:('layer '+i);
    const ranges=rowIndexRanges(layers[0]);

    // collect defined behaviour/macro names (label and node name both count).
    // A custom behaviour whose body references a layer behaviour (&mo/&lt/&to/...)
    // - i.e. nearly every layer-tap / layer hold-tap - activates a layer via its
    // numeric parameter. Record those so `&my_lt 3 SPC` counts as reaching layer 3
    // (without this the layer graph misses every custom layer-switch, the common
    // case, and floods false "unreachable" warnings).
    const defined=new Set();
    const behLayerKind=new Map();   // behaviour name -> layer-behaviour kind it wraps
    for(const b of childBlocks(src,'behaviors')){
      defined.add(b.name); if(b.label) defined.add(b.label);
      const lm=b.body.match(/&(mo|lt|to|tog|sl)\b/);
      if(lm){ behLayerKind.set(b.name, lm[1]); if(b.label) behLayerKind.set(b.label, lm[1]); }
    }
    // macros also get their layer references extracted: a macro containing
    // <&tog 3> makes layer 3 reachable from wherever the macro is bound
    // (the customkeymap mouse_enter/mouse_exit pattern).
    const macroRefs=new Map();
    for(const b of childBlocks(src,'macros')){
      defined.add(b.name); if(b.label) defined.add(b.label);
      const refs=[]; const re=/&(mo|lt|to|tog|sl)\s+(\d+)/g; let m;
      while((m=re.exec(b.body))!==null) refs.push({kind:m[1], layer:+m[2]});
      if(refs.length){ macroRefs.set(b.name, refs); if(b.label) macroRefs.set(b.label, refs); }
    }

    // combos
    const combos=childBlocks(src,'combos').map(c=>({
      name:c.name,
      positions:propNums(c.body,'key-positions')||[],
      timeout:propNum(c.body,'timeout-ms'),
      idle:propNum(c.body,'require-prior-idle-ms'),
      layers:propNums(c.body,'layers'),
      binding:(c.body.match(/bindings\s*=\s*<([^>]+)>/)||[,''])[1].trim(),
      slowRelease:hasProp(c.body,'slow-release'),
    })).filter(c=>c.positions.length);

    for(const c of combos){
      const bad=c.positions.filter(p=>p>=nKeys||p<0);
      if(bad.length) findings.push({
        id:'combo-out-of-range', severity:'error',
        title:`Combo “${c.name}” references key position${bad.length>1?'s':''} ${bad.join(', ')} - the board only has positions 0-${nKeys-1}`,
        detail:'ZMK counts key positions from 0 in binding order. An out-of-range position means this combo can never fire (and usually means the keymap was written for a different board size).',
        fix:'Re-count the intended keys on this board and update key-positions.',
      });
      // rollover risk only matters on layers you stream-type on: the base layer
      // and anything entered with &to/&tog. A combo scoped to a momentary layer
      // (held &mo) can't collide with normal typing - that scoping IS a valid
      // mitigation, so it isn't flagged.
      // Only 2-key combos are a realistic rollover trap: rolling two adjacent
      // keys inside the combo window happens constantly in normal typing.
      // 3+ member combos need a simultaneous triple rollover to misfire, which
      // in practice doesn't happen, so flagging them is noise (user feedback).
      const typedLayer = !c.layers || c.layers.includes(0);
      if(c.idle==null && typedLayer && c.positions.length<=2 && sameRowAdjacent(c.positions, ranges)){
        findings.push({
          id:'combo-rollover', severity:'warn',
          title:`Combo “${c.name}” sits on adjacent same-row keys with no require-prior-idle-ms`,
          detail:`Fast rolled keypresses across ${c.positions.join('+')} land inside the combo window (timeout-ms ${c.timeout!=null?c.timeout:'50 (default)'}), so ZMK must hold every press until the window closes - felt as lag or as combos firing mid-word. Two-key adjacent combos are the most common "my keyboard is slow" cause.`,
          fix:'Add `require-prior-idle-ms = <125>;` so it only triggers after a typing pause, scope it to a momentary layer with `layers = <…>;`, or move it to non-adjacent keys.',
        });
      }
      if(c.layers){
        const badL=c.layers.filter(l=>l>=layers.length||l<0);
        if(badL.length) findings.push({
          id:'combo-layer-range', severity:'error',
          title:`Combo “${c.name}” is scoped to layer ${badL.join(', ')}, which doesn't exist (layers 0-${layers.length-1})`,
          detail:'The combo will never fire on a non-existent layer.',
          fix:'Point the layers property at a real layer index.',
        });
      }
    }
    // duplicates / overlaps
    for(let i=0;i<combos.length;i++) for(let j=i+1;j<combos.length;j++){
      const A=combos[i],B=combos[j];
      const setA=new Set(A.positions), shared=B.positions.filter(p=>setA.has(p));
      const layersOverlap=!A.layers||!B.layers||A.layers.some(l=>B.layers.includes(l));
      if(!layersOverlap) continue;
      if(shared.length===A.positions.length && shared.length===B.positions.length){
        findings.push({
          id:'combo-duplicate', severity:'warn',
          title:`Combos “${A.name}” and “${B.name}” use the same key positions on overlapping layers`,
          detail:'Only one of them can win; which one is an implementation detail.',
          fix:'Delete one, or scope them to different layers.',
        });
      } else if(shared.length>=2){
        // Strict subset (all of the shorter combo's keys inside the longer's) is
        // the normal ZMK nested-combo pattern; longest match wins by design, so
        // it's intentional and not reported. Only partial overlaps interact badly.
        const minLen=Math.min(A.positions.length,B.positions.length);
        const isSubset=shared.length===minLen;
        if(!isSubset) findings.push({
          id:'combo-overlap', severity:'info',
          title:`Combos “${A.name}” and “${B.name}” share keys ${shared.join('+')}`,
          detail:'Overlapping combos are legal but interact: the longer combo needs its keys pressed strictly inside the window or the shorter one fires first.',
        });
      }
    }

    // hold-taps
    for(const b of childBlocks(src,'behaviors')){
      if(propStr(b.body,'compatible')!=='zmk,behavior-hold-tap') continue;
      const missing=[];
      if(propNum(b.body,'tapping-term-ms')==null) missing.push('tapping-term-ms (default 200)');
      if(!propStr(b.body,'flavor')) missing.push('flavor (default "hold-preferred" - eats fast taps)');
      if(missing.length) findings.push({
        id:'holdtap-defaults', severity:'info',
        title:`Hold-tap “${b.label||b.name}” relies on defaults: ${missing.join(', ')}`,
        detail:'Default hold-preferred at 200 ms is the most misfire-prone combination for home-row mods: fast rolls resolve as holds (modifiers instead of letters).',
        fix:'Consider `flavor = "balanced";` plus an explicit tapping-term-ms, and require-prior-idle-ms for home-row use.',
      });
    }

    // layer graph
    const edges=Array.from({length:layers.length},()=>new Set());
    const togTargets=new Set(), toTargets=new Set();
    // layer refs from a custom behaviour invocation: `&my_lt 3 X` -> layer 3,
    // using the layer-behaviour kind the custom behaviour wraps.
    const customLayerRefs=raw=>{
      const m=String(raw).match(/^&([\w-]+)\s+(\d+)/);
      return (m && behLayerKind.has(m[1])) ? [{kind:behLayerKind.get(m[1]), layer:+m[2]}] : [];
    };
    layers.forEach((L,li)=>{
      for(const ref of bindingRefs(L.bindings)){
        const refs=[...layerRefs(ref.raw), ...(macroRefs.get(ref.name)||[]), ...customLayerRefs(ref.raw)];
        for(const lr of refs){
          if(lr.layer<layers.length) edges[li].add(lr.layer);
          if(lr.kind==='tog') togTargets.add(lr.layer);
          if(lr.kind==='to') toTargets.add(lr.layer);
          if(lr.layer>=layers.length) findings.push({
            id:'layer-out-of-range', severity:'error',
            title:`“${ref.raw}” on ${layerName(li)} targets layer ${lr.layer}, but the keymap has layers 0-${layers.length-1}`,
            detail:'ZMK indexes layers by position in the keymap node. This binding does nothing (or worse, the wrong thing) as written.',
            fix:'Update the layer number or add the missing layer.',
          });
        }
      }
    });
    // combos switch layers too (binding may be a layer behaviour or a macro that
    // contains one - the customkeymap MouseEnter-combo pattern). A combo scoped
    // with `layers = <...>` adds edges from those layers; unscoped, from all.
    const comboLayerRefs=c=>{
      const nameM=String(c.binding||'').match(/^&([\w-]+)/);
      return [...layerRefs(String(c.binding||'')), ...((nameM&&macroRefs.get(nameM[1]))||[])];
    };
    for(const c of combos){
      const refs=comboLayerRefs(c);
      if(!refs.length) continue;
      const sources=c.layers ? c.layers.filter(l=>l>=0&&l<layers.length) : layers.map((_,i)=>i);
      for(const lr of refs){
        if(lr.layer>=layers.length) continue;
        for(const sIdx of sources) edges[sIdx].add(lr.layer);
        if(lr.kind==='tog') togTargets.add(lr.layer);
        if(lr.kind==='to') toTargets.add(lr.layer);
      }
    }
    // conditional layers: if all if-layers are active, then-layer activates
    for(const c of childBlocks(src,'conditional_layers')){
      const ifs=propNums(c.body,'if-layers'), then=propNum(c.body,'then-layer');
      if(ifs&&then!=null) for(const f of ifs) if(f<layers.length&&then<layers.length) edges[f].add(then);
    }
    // reachability from base
    const seen=new Set([0]); const stack=[0];
    while(stack.length){ const n=stack.pop(); for(const m of edges[n]) if(!seen.has(m)){ seen.add(m); stack.push(m); } }
    for(let i=1;i<layers.length;i++) if(!seen.has(i)) findings.push({
      id:'layer-unreachable', severity:'warn',
      title:`Layer ${i} (“${layerName(i)}”) is unreachable - nothing activates it`,
      detail:'No &mo/&lt/&to/&tog/&sl binding or conditional layer targets it from any reachable layer.',
      fix:'Bind a key to reach it, add it to a conditional layer, or delete it.',
    });
    // one-way layers: entered by &to/&tog but no way out from inside
    const effective=(li,p)=>{       // what the key does on layer li: resolve &trans toward base
      for(let j=li;j>=0;j--){
        const b=String((layers[j].bindings[p]||'')).trim();
        if(!/^&trans\b/.test(b)) return b;
      }
      return '&none';
    };
    for(const t of new Set([...toTargets,...togTargets])){
      if(t===0||t>=layers.length) continue;
      let hasExit=false;
      for(let p=0;p<nKeys;p++){
        const b=effective(t,p);
        const nameM=b.match(/^&([\w-]+)/);
        const lrs=[...layerRefs(b), ...((nameM&&macroRefs.get(nameM[1]))||[]), ...customLayerRefs(b)];
        for(const lr of lrs){
          // any layer-switch binding counts as a way out (tog same layer = direct exit)
          if(!(lr.kind==='to'&&lr.layer===t)){ hasExit=true; break; }
        }
        if(hasExit) break;
      }
      // an exit combo reachable on this layer also counts (MouseExit pattern)
      if(!hasExit) for(const c of combos){
        if(c.layers && !c.layers.includes(t)) continue;
        if(comboLayerRefs(c).some(lr=>!(lr.kind==='to'&&lr.layer===t))){ hasExit=true; break; }
      }
      if(!hasExit) findings.push({
        id:'layer-trap', severity:'error',
        title:`Layer ${t} (“${layerName(t)}”) can be entered with &to/&tog but has no way back`,
        detail:'Once on this layer (it stays active until explicitly left), no reachable binding switches layers again - the keyboard is stuck there until reboot. Momentary (&mo) layers exit on release; &to/&tog layers don\'t.',
        fix:`Add an exit on the layer itself, e.g. \`&to 0\` or \`&tog ${t}\` on some key.`,
      });
    }

    // dead transparencies
    // Positions that are &trans/&none on EVERY layer are treated as intentionally
    // unused (snapped-off outer columns, blanked thumb slots) and not reported.
    // The interesting bug is a position that IS used somewhere but falls through
    // to nothing elsewhere; that one stays flagged.
    const unusedEverywhere=new Set();
    for(let p=0;p<nKeys;p++){
      let usedSomewhere=false;
      for(const L of layers){
        const b=String(L.bindings[p]||'').trim();
        if(b && !/^&(trans|none)\b/.test(b)){ usedSomewhere=true; break; }
      }
      if(!usedSomewhere) unusedEverywhere.add(p);
    }
    const baseTrans=[];
    layers[0].bindings.forEach((b,p)=>{ if(/^&trans\b/.test(String(b).trim()) && !unusedEverywhere.has(p)) baseTrans.push(p); });
    if(baseTrans.length) findings.push({
      id:'trans-on-base', severity:'info',
      title:`${baseTrans.length} key${baseTrans.length>1?'s':''} on the base layer ${baseTrans.length>1?'are':'is'} &trans (position${baseTrans.length>1?'s':''} ${baseTrans.slice(0,12).join(', ')}${baseTrans.length>12?'…':''})`,
      detail:'There is nothing below the base layer to fall through to - &trans here behaves like &none. Usually a porting leftover.',
      fix:'Bind them, or make the intent explicit with &none.',
    });
    const deadFall=[];
    for(let li=1;li<layers.length;li++){
      for(let p=0;p<nKeys;p++){
        if(unusedEverywhere.has(p)) continue;
        const here=String(layers[li].bindings[p]||'').trim();
        if(!/^&trans\b/.test(here)) continue;
        let resolves=false;
        for(let j=li-1;j>=0;j--){
          const b=String(layers[j].bindings[p]||'').trim();
          if(/^&trans\b/.test(b)) continue;
          if(!/^&none\b/.test(b)) resolves=true;
          break;
        }
        if(!resolves) deadFall.push({layer:li,pos:p});
      }
    }
    if(deadFall.length){
      const byLayer={};
      deadFall.forEach(d=>{ (byLayer[d.layer]=byLayer[d.layer]||[]).push(d.pos); });
      findings.push({
        id:'trans-to-nothing', severity:'info',
        title:`${deadFall.length} &trans key${deadFall.length>1?'s':''} fall through to nothing`,
        detail:Object.entries(byLayer).map(([l,ps])=>`${layerName(+l)}: positions ${ps.slice(0,10).join(', ')}${ps.length>10?'…':''}`).join(' · ')
          +' - every layer underneath is &trans/&none, so these keys do nothing on those layers.',
        fix:'Fine if intentional; otherwise bind the position somewhere below.',
      });
    }

    // undefined behaviour references
    const unknown=new Map();
    layers.forEach((L,li)=>{
      for(const ref of bindingRefs(L.bindings)){
        if(BUILTIN.has(ref.name)||defined.has(ref.name)) continue;
        if(!unknown.has(ref.name)) unknown.set(ref.name,[]);
        unknown.get(ref.name).push(layerName(li));
      }
    });
    for(const [name,where] of unknown) findings.push({
      id:'behavior-undefined', severity:'error',
      title:`“&${name}” is used (${[...new Set(where)].join(', ')}) but never defined`,
      detail:'No behaviors/macros node defines it and it isn\'t a ZMK built-in. The firmware build will fail on this keymap.',
      fix:`Define ${name} in a behaviors{} or macros{} block, or fix the typo.`,
    });

    const order={error:0,warn:1,info:2};
    findings.sort((a,b)=>order[a.severity]-order[b.severity]);
    return findings;
  }

  const api={ diagnose, _internal:{ childBlocks, fallbackLayers, sameRowAdjacent, rowIndexRanges, stripComments } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node
  else root.KeymapDoctor = api;                                              // browser
})(typeof globalThis !== 'undefined' ? globalThis : this);
