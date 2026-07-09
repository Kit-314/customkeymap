/* Client-side AI keymap editor: the user supplies their own provider API key.
 *
 * The key goes straight from the browser to the chosen provider (Anthropic or OpenAI)
 * and never reaches the server. The model can only change the keymap through structured
 * tool calls that route into the round-trip-safe KeymapEngine, so it can't emit invalid
 * devicetree. Edits accumulate on a working copy; the UI shows a diff and the user
 * applies or discards.
 *
 * Provider drivers are injectable, so the agent loop runs against a mock with no network
 * (see the tests). Depends on the global KeymapEngine.
 */
(function (root) {
  'use strict';

  const DEFAULT_MODELS = { anthropic: 'claude-sonnet-4-5', openai: 'gpt-4o' };
  // Editable suggestions per provider (the model field is free text; these are just hints).
  const MODEL_SUGGESTIONS = {
    anthropic: ['claude-sonnet-4-5', 'claude-opus-4-5', 'claude-haiku-4-5', 'claude-3-5-sonnet-latest'],
    openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'o4-mini'],
  };
  const MODEL_DOCS = {
    anthropic: 'https://docs.anthropic.com/en/docs/about-claude/models',
    openai: 'https://platform.openai.com/docs/models',
  };

  // Tools the model may call (logical defs; drivers convert these to provider format).
  const TOOL_DEFS = [
    { name: 'get_keymap',
      description: 'Read the current keymap: every layer (index + name + its bindings, where each binding’s array position is the key position) plus combos and custom behaviours. Call this first if unsure of positions or names.',
      schema: { type: 'object', properties: {}, required: [] } },
    { name: 'set_binding',
      description: 'Change one key. layer = 0-based layer index, position = 0-based index into that layer’s bindings, binding = a full ZMK binding string starting with & (e.g. "&kp ESC", "&mt LSHFT A", "&lt 1 SPACE", "&trans", "&none").',
      schema: { type: 'object', properties: {
        layer: { type: 'integer', description: '0-based layer index' },
        position: { type: 'integer', description: '0-based key position within the layer' },
        binding: { type: 'string', description: 'full ZMK binding, must start with &' },
      }, required: ['layer', 'position', 'binding'] } },
    { name: 'add_layer',
      description: 'Append a new empty layer (all &trans) at the end. Returns once added; its index is the new highest.',
      schema: { type: 'object', properties: { name: { type: 'string', description: 'layer name: letters/numbers/underscore, not starting with a digit' } }, required: ['name'] } },
    { name: 'rename_layer',
      description: 'Rename a layer (cosmetic; references are by index so nothing else changes).',
      schema: { type: 'object', properties: { layer: { type: 'integer' }, name: { type: 'string' } }, required: ['layer', 'name'] } },
    { name: 'move_layer',
      description: 'Reorder layers. from/to are 0-based; the layer at `from` ends up at index `to`. All layer references (&mo/&lt/&to/&tog/&sl, combos, conditional layers, #defines) are renumbered automatically.',
      schema: { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' } }, required: ['from', 'to'] } },
    { name: 'delete_layer',
      description: 'Delete a layer by index. Keys that referenced it become &none; remaining layers are renumbered automatically. Cannot delete the only layer.',
      schema: { type: 'object', properties: { layer: { type: 'integer' } }, required: ['layer'] } },
    { name: 'add_combo',
      description: 'Add a combo: pressing the keys at `positions` together emits `binding`. positions are 0-based key positions (same as set_binding). timeoutMs optional (default 50). layers optional (array of layer indices it is active on; omit for all).',
      schema: { type: 'object', properties: {
        name: { type: 'string' },
        positions: { type: 'array', items: { type: 'integer' }, description: 'at least 2 key positions' },
        binding: { type: 'string', description: 'output binding starting with &' },
        timeoutMs: { type: 'integer' },
        layers: { type: 'array', items: { type: 'integer' } },
      }, required: ['name', 'positions', 'binding'] } },
    { name: 'remove_combo',
      description: 'Remove a combo by its name.',
      schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  ];

  function buildState(model) {
    const layers = model.layers.map((L, i) => ({ index: i, name: L.name, bindings: KeymapEngine.layerBindings(model, i) }));
    let combos = [];
    try { combos = KeymapEngine.parseCombos(model).combos.map(c => ({ name: c.name, positions: c.positions, binding: c.binding, layers: c.layers })); } catch (e) {}
    return { layers, combos, key_count: layers[0] ? layers[0].bindings.length : 0 };
  }

  function systemPrompt(text) {
    let state = '{}';
    try { state = JSON.stringify(buildState(KeymapEngine.parseKeymap(text))); } catch (e) {}
    return [
      'You are a careful assistant that edits a ZMK keyboard keymap on the user’s behalf.',
      'Make ONLY the changes the user asks for, using the provided tools. Do not redesign things they did not mention.',
      'Key positions and layer indices are 0-based. A binding’s position is its index in a layer’s bindings array.',
      'Bindings are ZMK strings starting with & (e.g. &kp A, &mt LSHFT A, &lt 1 SPACE, &mo 2, &trans, &none, &kp C_VOL_UP, &bt BT_CLR).',
      'If you are unsure about current positions/names, call get_keymap first.',
      'IMPORTANT: your tool calls only build a PROPOSAL. Nothing is applied to the user’s keymap until they review a diff and click Apply themselves. When finished, reply (no tool call) with a brief summary phrased as a proposal - e.g. “This will change…”, “Proposed:”. Do NOT say the changes are done, made, saved, or applied.',
      'Current keymap state:', state,
    ].join('\n');
  }

  // Execute one tool call against `text`; returns {ok, text:<result string>, newText?}.
  function executeTool(name, input, text) {
    input = input || {};
    try {
      const m = KeymapEngine.parseKeymap(text);
      switch (name) {
        case 'get_keymap':
          return { ok: true, text: JSON.stringify(buildState(m)) };
        case 'set_binding': {
          if (typeof input.binding !== 'string' || input.binding.trim()[0] !== '&')
            return { ok: false, text: 'binding must start with &' };
          const nt = KeymapEngine.setBinding(m, input.layer, input.position, input.binding.trim());
          const v = KeymapEngine.validateSetBinding(m, nt, input.layer, input.position, input.binding.trim());
          if (!v.ok) return { ok: false, text: 'rejected (would corrupt file): ' + v.errors.join('; ') };
          return { ok: true, newText: nt, text: `set layer ${input.layer} pos ${input.position} = ${input.binding.trim()}` };
        }
        case 'add_layer':
          return { ok: true, newText: KeymapEngine.addLayer(m, input.name), text: 'added layer ' + input.name };
        case 'rename_layer':
          return { ok: true, newText: KeymapEngine.renameLayer(m, input.layer, input.name), text: 'renamed layer ' + input.layer + ' to ' + input.name };
        case 'move_layer':
          return { ok: true, newText: KeymapEngine.moveLayer(m, input.from, input.to), text: `moved layer ${input.from} -> ${input.to}` };
        case 'delete_layer':
          return { ok: true, newText: KeymapEngine.deleteLayer(m, input.layer), text: 'deleted layer ' + input.layer };
        case 'add_combo': {
          if (!Array.isArray(input.positions) || input.positions.length < 2) return { ok: false, text: 'need at least 2 positions' };
          if (typeof input.binding !== 'string' || input.binding.trim()[0] !== '&') return { ok: false, text: 'binding must start with &' };
          const err = KeymapEngine.comboNameError(m, input.name);
          if (err) return { ok: false, text: err };
          const nt = KeymapEngine.addCombo(m, { name: input.name, keyPositions: input.positions, binding: input.binding.trim(), timeoutMs: input.timeoutMs || 50, layers: input.layers || null });
          return { ok: true, newText: nt, text: 'added combo ' + input.name };
        }
        case 'remove_combo': {
          const cs = KeymapEngine.parseCombos(m).combos;
          const idx = cs.findIndex(c => c.name === input.name);
          if (idx < 0) return { ok: false, text: 'no combo named ' + input.name };
          return { ok: true, newText: KeymapEngine.removeCombo(m, idx), text: 'removed combo ' + input.name };
        }
        default:
          return { ok: false, text: 'unknown tool ' + name };
      }
    } catch (e) {
      return { ok: false, text: 'error: ' + (e && e.message || e) };
    }
  }

  // Human-readable diff between two keymap texts (parsed, not raw-line).
  function computeSummary(before, after) {
    const lines = [];
    let A, B;
    try { A = KeymapEngine.parseKeymap(before); B = KeymapEngine.parseKeymap(after); }
    catch (e) { return ['(could not parse diff)']; }
    const aN = A.layers.map(l => l.name), bN = B.layers.map(l => l.name);
    bN.filter(n => !aN.includes(n)).forEach(n => lines.push(`+ Added layer “${n}”`));
    aN.filter(n => !bN.includes(n)).forEach(n => lines.push(`− Deleted layer “${n}”`));
    const common = aN.filter(n => bN.includes(n));
    const aOrd = common.map(n => aN.indexOf(n)), bOrd = common.map(n => bN.indexOf(n));
    if (JSON.stringify(aOrd) !== JSON.stringify(bOrd)) lines.push(`↕ Reordered layers -> ${bN.join(', ')}`);
    common.forEach(n => {
      const at = KeymapEngine.layerBindings(A, aN.indexOf(n)), bt = KeymapEngine.layerBindings(B, bN.indexOf(n));
      const len = Math.max(at.length, bt.length);
      for (let i = 0; i < len; i++) if (at[i] !== bt[i]) lines.push(`• ${n} · pos ${i}: ${at[i] || '-'} -> ${bt[i] || '-'}`);
    });
    try {
      const ca = KeymapEngine.parseCombos(A).combos, cb = KeymapEngine.parseCombos(B).combos;
      const caN = ca.map(c => c.name), cbN = cb.map(c => c.name);
      cbN.filter(n => !caN.includes(n)).forEach(n => lines.push(`+ Added combo “${n}”`));
      caN.filter(n => !cbN.includes(n)).forEach(n => lines.push(`− Removed combo “${n}”`));
    } catch (e) {}
    return lines.length ? lines : ['(no changes)'];
  }

  // Agent loop (provider-agnostic via an injected driver).
  async function runAgent(driver, opts) {
    const onLog = opts.onLog || function () {};
    const maxSteps = opts.maxSteps || 12;
    let workingText = opts.keymapText;
    driver.addUser(opts.instruction);
    let finalText = '';
    for (let step = 0; step < maxSteps; step++) {
      const { toolUses, text } = await driver.send(systemPrompt(workingText), TOOL_DEFS);
      if (text) onLog('ai', text);
      if (!toolUses || !toolUses.length) { finalText = text || ''; break; }
      const results = [];
      for (const tu of toolUses) {
        const r = executeTool(tu.name, tu.input, workingText);
        if (r.ok && r.newText != null) workingText = r.newText;
        onLog('tool', `${tu.name}(${JSON.stringify(tu.input)}) -> ${r.ok ? r.text : 'ERROR: ' + r.text}`);
        results.push({ id: tu.id, content: r.text });
      }
      driver.recordToolResults(results);
      if (step === maxSteps - 1) onLog('warn', 'Reached the step limit - stopping.');
    }
    return { newText: workingText, summary: computeSummary(opts.keymapText, workingText), finalText };
  }

  // Provider drivers.
  function anthropicDriver(cfg) {
    const messages = []; let last = null;
    const fetchFn = cfg.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    return {
      addUser(t) { messages.push({ role: 'user', content: t }); },
      async send(system, defs) {
        const tools = defs.map(d => ({ name: d.name, description: d.description, input_schema: d.schema }));
        const res = await fetchFn('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
          body: JSON.stringify({ model: cfg.model || DEFAULT_MODELS.anthropic, max_tokens: 1500, system, tools, messages }),
        });
        if (!res.ok) throw new Error('Anthropic API ' + res.status + ': ' + (await res.text()).slice(0, 400));
        const data = await res.json(); last = data;
        const content = data.content || [];
        return {
          toolUses: content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, input: b.input })),
          text: content.filter(b => b.type === 'text').map(b => b.text).join('\n'),
        };
      },
      recordToolResults(results) {
        messages.push({ role: 'assistant', content: last.content });
        messages.push({ role: 'user', content: results.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.content })) });
      },
    };
  }

  function openaiDriver(cfg) {
    const messages = []; let last = null;
    const fetchFn = cfg.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    return {
      addUser(t) { messages.push({ role: 'user', content: t }); },
      async send(system, defs) {
        const tools = defs.map(d => ({ type: 'function', function: { name: d.name, description: d.description, parameters: d.schema } }));
        const res = await fetchFn('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + cfg.apiKey },
          body: JSON.stringify({ model: cfg.model || DEFAULT_MODELS.openai, messages: [{ role: 'system', content: system }].concat(messages), tools, tool_choice: 'auto' }),
        });
        if (!res.ok) throw new Error('OpenAI API ' + res.status + ': ' + (await res.text()).slice(0, 400));
        const data = await res.json(); const msg = data.choices[0].message; last = msg;
        return {
          toolUses: (msg.tool_calls || []).map(tc => ({ id: tc.id, name: tc.function.name, input: safeParse(tc.function.arguments) })),
          text: msg.content || '',
        };
      },
      recordToolResults(results) {
        messages.push(last);
        results.forEach(r => messages.push({ role: 'tool', tool_call_id: r.id, content: r.content }));
      },
    };
  }

  function safeParse(s) { try { return JSON.parse(s || '{}'); } catch (e) { return {}; } }

  // List the model IDs the given key can actually use (queried from the provider).
  async function listModels(cfg) {
    const fetchFn = cfg.fetch || (typeof fetch !== 'undefined' ? fetch : null);
    if (cfg.provider === 'openai') {
      const res = await fetchFn('https://api.openai.com/v1/models', { headers: { authorization: 'Bearer ' + cfg.apiKey } });
      if (!res.ok) throw new Error('OpenAI models ' + res.status + ': ' + (await res.text()).slice(0, 300));
      const d = await res.json();
      return (d.data || []).map(m => m.id).filter(id => /^(gpt-|o\d|chatgpt)/i.test(id)).sort();
    }
    const res = await fetchFn('https://api.anthropic.com/v1/models?limit=100', {
      headers: { 'x-api-key': cfg.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
    });
    if (!res.ok) throw new Error('Anthropic models ' + res.status + ': ' + (await res.text()).slice(0, 300));
    const d = await res.json();
    return (d.data || []).map(m => m.id);   // Anthropic returns newest first
  }

  const api = { TOOL_DEFS, buildState, systemPrompt, executeTool, computeSummary, runAgent,
                anthropicDriver, openaiDriver, listModels, DEFAULT_MODELS, MODEL_SUGGESTIONS, MODEL_DOCS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.AIEditor = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
