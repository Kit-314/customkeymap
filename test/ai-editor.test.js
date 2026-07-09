/* Tests for the BYOK AI editor agent loop (mock driver + fake fetch, no network).
   Run: node test/ai-editor.test.js */
const assert = require('assert');
global.KeymapEngine = require('../editor-engine.js');
const AI = require('../ai-editor.js');
let pass = 0;
const ok = (c, m) => { assert.ok(c, m); console.log('  ✓ ' + m); pass++; };
const eq = (a, b, m) => { assert.strictEqual(a, b, `${m}\n  exp: ${JSON.stringify(b)}\n  got: ${JSON.stringify(a)}`); console.log('  ✓ ' + m); pass++; };

const SRC = `/ {
    keymap {
        compatible = "zmk,keymap";

        base {
            bindings = <&kp Q &kp W &kp E &kp R>;
        };

        lower {
            bindings = <&kp N1 &kp N2 &kp N3 &kp N4>;
        };
    };
};
`;

console.log('executeTool: set_binding');
let r = AI.executeTool('set_binding', { layer: 0, position: 0, binding: '&kp Z' }, SRC);
ok(r.ok && r.newText.includes('&kp Z &kp W'), 'set_binding edits the right key');
r = AI.executeTool('set_binding', { layer: 0, position: 0, binding: 'kp Z' }, SRC);
ok(!r.ok, 'set_binding rejects a binding not starting with &');

console.log('executeTool: get_keymap returns state');
r = AI.executeTool('get_keymap', {}, SRC);
const st = JSON.parse(r.text);
eq(st.layers.length, 2, 'state has 2 layers');
eq(st.layers[0].bindings.join(' '), '&kp Q &kp W &kp E &kp R', 'state lists bindings');

console.log('executeTool: add_combo + remove_combo');
r = AI.executeTool('add_combo', { name: 'c_esc', positions: [0, 1], binding: '&kp ESC' }, SRC);
ok(r.ok && AI.executeTool('get_keymap', {}, r.newText).text.includes('c_esc'), 'add_combo works');
const withCombo = r.newText;
r = AI.executeTool('remove_combo', { name: 'c_esc' }, withCombo);
ok(r.ok && !r.newText.includes('c_esc'), 'remove_combo works');
r = AI.executeTool('add_combo', { name: 'x', positions: [0], binding: '&kp ESC' }, SRC);
ok(!r.ok, 'add_combo needs ≥2 positions');

console.log('computeSummary');
const after = AI.executeTool('set_binding', { layer: 0, position: 2, binding: '&kp X' }, SRC).newText;
const sum = AI.computeSummary(SRC, after);
ok(sum.some(l => /pos 2/.test(l) && /&kp X/.test(l)), 'summary describes the changed key');

// Mock driver: scripts the model's turns (no provider involved).
function mockDriver(turns) {
  let i = 0; const recorded = [];
  return {
    addUser() {},
    async send() { return turns[i++] || { toolUses: [], text: '' }; },
    recordToolResults(res) { recorded.push(res); },
    _recorded: recorded,
  };
}

(async () => {
  console.log('runAgent: multi-step (edit then finish)');
  const d = mockDriver([
    { toolUses: [{ id: '1', name: 'set_binding', input: { layer: 0, position: 0, binding: '&kp Z' } }], text: '' },
    { toolUses: [{ id: '2', name: 'add_layer', input: { name: 'nav' } }], text: '' },
    { toolUses: [], text: 'Changed Q→Z and added a nav layer.' },
  ]);
  const logs = [];
  const out = await AI.runAgent(d, { instruction: 'do stuff', keymapText: SRC, onLog: (k, m) => logs.push(k) });
  ok(out.newText.includes('&kp Z &kp W'), 'agent applied set_binding to working copy');
  ok(/nav \{/.test(out.newText), 'agent applied add_layer');
  eq(KeymapEngine.parseKeymap(out.newText).layers.length, 3, 'working copy now has 3 layers');
  eq(out.finalText, 'Changed Q→Z and added a nav layer.', 'final text captured');
  ok(out.summary.some(l => /Added layer/.test(l)), 'summary notes the added layer');
  ok(logs.includes('tool') && logs.includes('ai'), 'logs include tool + ai entries');

  console.log('anthropicDriver: parses tool_use + records results (fake fetch)');
  let aQ = [
    { ok: true, async json() { return { content: [{ type: 'tool_use', id: 'a1', name: 'get_keymap', input: {} }] }; } },
    { ok: true, async json() { return { content: [{ type: 'text', text: 'all set' }] }; } },
  ], ai = 0;
  const aBodies = [];
  const aFetch = async (url, opt) => { aBodies.push(JSON.parse(opt.body)); return aQ[ai++]; };
  const ad = AI.anthropicDriver({ apiKey: 'sk-x', fetch: aFetch });
  ad.addUser('hi');
  let s = await ad.send('sys', AI.TOOL_DEFS);
  eq(s.toolUses.length, 1, 'anthropic: one tool_use parsed');
  eq(s.toolUses[0].name, 'get_keymap', 'anthropic: tool name parsed');
  ad.recordToolResults([{ id: 'a1', content: '{}' }]);
  s = await ad.send('sys', AI.TOOL_DEFS);
  eq(s.toolUses.length, 0, 'anthropic: second turn has no tools');
  eq(s.text, 'all set', 'anthropic: final text parsed');
  ok(aBodies[1].messages.some(m => m.role === 'assistant') && aBodies[1].messages.some(m => Array.isArray(m.content) && m.content.some(c => c.type === 'tool_result')), 'anthropic: history has assistant + tool_result');
  ok(aBodies[0].headers === undefined && aBodies[0].tools.length === AI.TOOL_DEFS.length, 'anthropic: tools sent in body');

  console.log('openaiDriver: parses tool_calls + records results (fake fetch)');
  let oQ = [
    { ok: true, async json() { return { choices: [{ message: { content: null, tool_calls: [{ id: 'o1', type: 'function', function: { name: 'set_binding', arguments: '{"layer":0,"position":0,"binding":"&kp Z"}' } }] } }] }; } },
    { ok: true, async json() { return { choices: [{ message: { content: 'done' } }] }; } },
  ], oi = 0;
  const oBodies = [];
  const oFetch = async (url, opt) => { oBodies.push(JSON.parse(opt.body)); return oQ[oi++]; };
  const od = AI.openaiDriver({ apiKey: 'sk-y', fetch: oFetch });
  od.addUser('hi');
  s = await od.send('sys', AI.TOOL_DEFS);
  eq(s.toolUses[0].name, 'set_binding', 'openai: tool name parsed');
  eq(s.toolUses[0].input.binding, '&kp Z', 'openai: JSON arguments parsed');
  od.recordToolResults([{ id: 'o1', content: 'ok' }]);
  s = await od.send('sys', AI.TOOL_DEFS);
  eq(s.text, 'done', 'openai: final text parsed');
  ok(oBodies[1].messages.some(m => m.role === 'tool' && m.tool_call_id === 'o1'), 'openai: tool result message recorded');
  ok(oBodies[1].messages[0].role === 'system', 'openai: system prepended each call');

  console.log('listModels (fake fetch)');
  const aModels = await AI.listModels({ provider: 'anthropic', apiKey: 'k', fetch: async () => ({ ok: true, async json() { return { data: [{ id: 'claude-sonnet-4-5' }, { id: 'claude-opus-4-5' }] }; }, async text() { return ''; } }) });
  eq(aModels.join(','), 'claude-sonnet-4-5,claude-opus-4-5', 'anthropic model ids listed');
  const oModels = await AI.listModels({ provider: 'openai', apiKey: 'k', fetch: async () => ({ ok: true, async json() { return { data: [{ id: 'gpt-4o' }, { id: 'whisper-1' }, { id: 'o4-mini' }] }; }, async text() { return ''; } }) });
  ok(oModels.includes('gpt-4o') && oModels.includes('o4-mini') && !oModels.includes('whisper-1'), 'openai list filtered to chat/reasoning models');
  let threw = false;
  try { await AI.listModels({ provider: 'anthropic', apiKey: 'bad', fetch: async () => ({ ok: false, status: 401, async text() { return 'unauthorized'; } }) }); } catch (e) { threw = /401/.test(e.message); }
  ok(threw, 'listModels throws on non-ok response');

  console.log(`\nALL ${pass} ASSERTIONS PASSED`);
})();
