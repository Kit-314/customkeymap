/* Tests for branch targeting in the GitHub loader:
   - parseGitHubInput: owner/repo/tree/<branch>, github.com .../tree/<branch> URLs,
     and @branch shorthand all surface the branch (as an explicit branch or a treePath
     to resolve), without breaking bare repo / subdir / owner inputs.
   - matchBranchPrefix: resolves an ambiguous "branch[/subdir]" tree path against a
     repo's real branch names, picking the LONGEST matching branch (so slash-containing
     branch names like feat/x work). Both are pure functions extracted from index.html. */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// Pull a top-level `function NAME(...) { ... }` out of index.html by brace-counting.
// (Both target functions contain only balanced braces - object literals and ${} in
// template strings - so naive counting is safe here.)
function extractFn(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) throw new Error('function not found: ' + name);
  let depth = 0, started = false;
  for (let j = src.indexOf('{', start); j < src.length; j++) {
    if (src[j] === '{') { depth++; started = true; }
    else if (src[j] === '}') { depth--; if (started && depth === 0) return src.slice(start, j + 1); }
  }
  throw new Error('unbalanced braces extracting ' + name);
}
const parseGitHubInput = eval('(' + extractFn(html, 'parseGitHubInput') + ')');
const matchBranchPrefix = eval('(' + extractFn(html, 'matchBranchPrefix') + ')');

let n = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); n++; console.log('  ✓ ' + msg); };

// --- parseGitHubInput ---
const bareRepo = parseGitHubInput('user/repo');
ok(bareRepo.kind === 'repo' && bareRepo.branch === null && !bareRepo.treePath,
   'bare owner/repo: no branch, no treePath (uses default branch)');

const atBranch = parseGitHubInput('user/repo@dev');
ok(atBranch.branch === 'dev' && !atBranch.treePath,
   'owner/repo@branch: explicit branch, no treePath');

const shTree = parseGitHubInput('user/repo/tree/my-branch');
ok(shTree.kind === 'repo' && shTree.branch === null && shTree.treePath === 'my-branch',
   'owner/repo/tree/branch shorthand: surfaces treePath (the requester\'s form)');

const shTreeSlash = parseGitHubInput('user/repo/tree/feat/x');
ok(shTreeSlash.treePath === 'feat/x',
   'owner/repo/tree/feat/x shorthand: treePath keeps the slash');

const urlTree = parseGitHubInput('https://github.com/user/repo/tree/feat/x');
ok(urlTree.treePath === 'feat/x' && urlTree.branch === null,
   'github.com/.../tree/feat/x URL: treePath keeps the slash (no first-slash truncation)');

const subdir = parseGitHubInput('user/repo/config/sub');
ok(subdir.kind === 'repo' && subdir.subdir === 'config/sub' && !subdir.treePath,
   'owner/repo/subdir (not tree): treated as subdir, not a branch');

const bareUrl = parseGitHubInput('https://github.com/user/repo');
ok(bareUrl.kind === 'repo' && bareUrl.branch === null && !bareUrl.treePath,
   'bare github.com repo URL: no branch, no treePath');

// --- matchBranchPrefix ---
const B = [{ name: 'main', sha: 'aaa' }, { name: 'feat/x', sha: 'bbb' }, { name: 'feat', sha: 'ccc' }];

const m1 = matchBranchPrefix('feat/x/config', B);
ok(m1 && m1.branch === 'feat/x' && m1.sha === 'bbb' && m1.subdir === 'config',
   'feat/x/config -> longest branch feat/x + subdir config (not branch feat)');

const m2 = matchBranchPrefix('feat/x', B);
ok(m2 && m2.branch === 'feat/x' && m2.subdir === '',
   'feat/x exact -> branch feat/x, no subdir (prefers longest over feat)');

const m3 = matchBranchPrefix('main', B);
ok(m3 && m3.branch === 'main' && m3.subdir === '',
   'main -> branch main, no subdir');

const m4 = matchBranchPrefix('nope/here', B);
ok(m4 === null, 'unknown branch -> null (caller falls back to first-segment split)');

console.log('\n' + n + ' assertions passed.');
