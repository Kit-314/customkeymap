# customkeymap

A web tool for viewing and editing ZMK keymaps. Point it at a GitHub repo and it renders
every layer with each key labelled; edit keys, layers, combos and behaviours, then
download the result or commit it back to GitHub.

Hosted at [customkeymap.com](https://customkeymap.com). MIT licensed; this repo is the
code that runs there.

## Why it exists

ZMK is powerful, but editing a keymap means hand-writing devicetree, and the official
live editor (ZMK Studio) only covers part of what ZMK can do. customkeymap renders any
board's keymap with every key explained, and edits the parts Studio can't reach.

### Compared to ZMK Studio

ZMK Studio edits the keymap live on the running keyboard, over USB or Bluetooth, talking
to firmware built with Studio support. The live link is the appeal, but it's limited:

- It only edits per-layer key bindings. Combos, macros and custom behaviours (mod-morphs,
  hold-taps, tap-dances) live in the source and are out of its reach.
- It needs firmware built with Studio enabled.
- It edits a runtime copy of the keymap that can shadow the source you maintain - a live
  session can stop your combos firing until you disconnect.

customkeymap edits the source `.keymap` file itself, so it handles everything ZMK can
express: combos, behaviours, macros, conditional layers, any board, all layers, with your
comments and formatting left intact.

### Why it can't change the keyboard live

That's the trade-off of editing source instead of the running firmware: a change here
doesn't take effect on the keyboard until you build and flash new firmware (commit, let
CI build it, flash the `.uf2` onto each half). There's no live connection to the device.
Studio gives instant on-device changes for a narrow set; this gives the full range of ZMK
but needs a flash. Live tuning for the subset that can safely change at runtime is
planned.

## API keys stay in your browser

The editor has an optional AI mode: paste your own Anthropic or OpenAI key and describe
changes in plain English. The key goes straight from your browser to the provider and
never reaches the server. The API calls are plain client-side JavaScript in this repo, so
you can check where the key goes.

The only server-side code is in [`functions/`](functions/): a read-only GitHub proxy to
avoid anonymous rate limits, and the GitHub OAuth token exchange. Their credentials live
in environment variables on the host, not in this repo.

## Open by default

This repo is the product - the same code, deployed straight from `main`, MIT-licensed.
Nothing's hidden: read it, fork it, run your own copy, open a PR. No account is needed
just to view a keymap, your API keys and configs never touch the server, and development
happens in the open. If a tool is going to read your repos and edit your keymaps, you
should be able to see exactly what it does - here, you can.

## What it does

- Load from GitHub by pasting an owner, `owner/repo`, or a direct `.keymap` link.
  To target a branch, use `owner/repo@branch`, `owner/repo/tree/branch`, or paste a
  `github.com/owner/repo/tree/branch` URL - branch names with slashes (e.g. `feat/x`) work.
- Resolve `#include`s and expand C-preprocessor templates, so template-driven configs
  still render.
- Parse the keymap's `behaviors {}` block, so custom mod-taps, layer-taps, mod-morphs and
  tap-dances render by meaning rather than raw text.
- Show a plain-English tooltip on every key.
- Render any board, not just Corne-shaped ones.
- Edit keys, layers, combos and behaviours (in progress). Edits splice into the original
  text and preserve comments and formatting.

## Running it

It's a static `index.html` plus a few JS files, with no build step.

- Visualizer and editor only: open `index.html`, or serve the folder from any static host.
- With the GitHub proxy and OAuth: deploy somewhere that runs `functions/` as serverless
  functions (e.g. Cloudflare Pages). Set `GH_TOKEN` (any GitHub token, no scopes needed)
  to lift the rate limit.

## Development

Vanilla JS, no dependencies. The editor engine is pure and DOM-free, so it has tests:

```
node test/editor-engine.test.js
```

## License

[MIT](LICENSE) © Kit Hargreaves
