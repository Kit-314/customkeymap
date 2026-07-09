/* layout-json.js - parse a QMK/KLE-style `info.json` "layouts" object into the
   same internal geometry model customkeymap already uses for ZMK physical layouts:
   an array of layouts, each an array of keys {w,h,x,y,rot,rx,ry} in centi-units
   (100 = 1u) with rot in centi-degrees.

   This is the format popularised on the ZMK side by Nick Coutsos' Keymap Editor
   (https://github.com/nickcoutsos/keymap-editor), itself based on QMK's info.json,
   itself based on Keyboard Layout Editor. Used here with Nick's blessing, and only
   to read a file already present in the user's own loaded repo - customkeymap never
   depends on his contrib catalogue as a data source.

   Field semantics, confirmed against his reference impl (keymap-layout-tools/lib/
   geometry.js):
     - x, y          absolute key position, in key units (1u = 1).
     - u | w, h      width / height in key units (default 1). Keymap Editor writes
                     width as `u`; QMK/KLE write `w`. Accept either.
     - r             rotation in degrees, clockwise (y-down).
     - rx, ry        absolute rotation pivot, in key units; default to the key's own
                     x, y (i.e. rotate about its top-left) when omitted.
     - row, col      Keymap Editor's own additions for its text-table / ortho view;
                     irrelevant to geometry and ignored here. The layout array is
                     index-aligned to the keymap's bindings, same as the ZMK path.
*/
(function (root) {
  // First finite number among the arguments; the last argument is the default.
  function num() {
    for (var i = 0; i < arguments.length - 1; i++) {
      var v = arguments[i];
      if (typeof v === 'number' && isFinite(v)) return v;
    }
    return arguments[arguments.length - 1];
  }

  function convertKey(k) {
    if (!k || typeof k !== 'object') return null;
    // Require real coordinates - this is what makes the parser reject non-layout
    // JSON (package.json, tsconfig, …) that happens to be fetched.
    if (typeof k.x !== 'number' || typeof k.y !== 'number' ||
        !isFinite(k.x) || !isFinite(k.y)) return null;
    var w = num(k.u, k.w, 1);
    var h = num(k.h, 1);
    var r = num(k.r, 0);
    var rx = num(k.rx, k.x);
    var ry = num(k.ry, k.y);
    var c = function (n) { return Math.round(n * 100); };
    return { w: c(w), h: c(h), x: c(k.x), y: c(k.y), rot: c(r), rx: c(rx), ry: c(ry) };
  }

  // Accepts a JSON string or an already-parsed object. Returns an array of layouts
  // (each an array of keys), mirroring parsePhysicalLayouts(). Returns [] for
  // anything that isn't a recognisable `layouts` map - never throws.
  function parseQmkInfoJson(input) {
    var data = input;
    if (typeof input === 'string') {
      try { data = JSON.parse(input); } catch (e) { return []; }
    }
    if (!data || typeof data !== 'object' || !data.layouts ||
        typeof data.layouts !== 'object') return [];

    var out = [];
    var names = Object.keys(data.layouts);
    for (var i = 0; i < names.length; i++) {
      var entry = data.layouts[names[i]];
      var arr = Array.isArray(entry) ? entry
              : (entry && Array.isArray(entry.layout)) ? entry.layout
              : null;
      if (!arr) continue;
      var keys = [];
      for (var j = 0; j < arr.length; j++) {
        var key = convertKey(arr[j]);
        if (key) keys.push(key);
      }
      // Only accept a layout if every entry converted - a partial parse means we
      // don't actually understand this file, and a wrong key count renders wrong.
      if (keys.length && keys.length === arr.length) out.push(keys);
    }
    return out;
  }

  var api = { parseQmkInfoJson: parseQmkInfoJson, _internal: { convertKey: convertKey, num: num } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // node
  else root.LayoutJson = api;                                               // browser
})(typeof globalThis !== 'undefined' ? globalThis : this);
