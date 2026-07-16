#!/usr/bin/env node
import { ConvexHttpClient } from "convex/browser";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

const CONVEX_URL = "https://rare-newt-287.convex.cloud";
const CC_DIR = join(homedir(), ".cc");
const CC_CONFIG = join(CC_DIR, "config.json");

const readConfig = () => { try { return JSON.parse(readFileSync(CC_CONFIG, "utf-8")); } catch { return {}; } };
const writeConfig = data => { if (!existsSync(CC_DIR)) mkdirSync(CC_DIR, { recursive: true }); writeFileSync(CC_CONFIG, JSON.stringify(data, null, 2)); };
const client = new ConvexHttpClient(CONVEX_URL);

const cmd = process.argv[2];
const arg = process.argv.slice(3).join(" ");

const authGuard = () => {
  const cfg = readConfig();
  if (!cfg.token) { console.error("[CC] Not authenticated. Run: cc auth <token>"); process.exitCode = 1; return null; }
  return cfg;
};

const waitForResult = async (token, requestId, timeout = 120000) => {
  for (let ms = 0; ms < timeout; ms += 800) {
    await new Promise(r => setTimeout(r, 800));
    process.stderr.write(".");                                         // stderr is unbuffered
    const res = await client.query("action:getResult", { token, requestId });
    if (res) return res;
  }
  throw new Error("Timed out waiting for result");
};

const fetchResultJson = async (token, requestId) => {
  const res = await waitForResult(token, requestId);
  console.log();
  if (res.status === "failed") throw new Error(res.error || "Plugin reported failure");
  if (!res.storageUrl) throw new Error("No result payload");
  return fetch(res.storageUrl).then(r => { if (!r.ok) throw new Error(`Storage fetch ${r.status}`); return r.json(); });
};

const fetchResultText = async (token, requestId) => {
  const res = await waitForResult(token, requestId);
  console.log();
  if (res.status === "failed") throw new Error(res.error || "Plugin reported failure");
  if (!res.storageUrl) throw new Error("No result payload");
  return fetch(res.storageUrl).then(r => { if (!r.ok) throw new Error(`Storage fetch ${r.status}`); return r.text(); });
};

const printHelp = () => {
  console.log("figmacode — authenticate and drive the CodeConvert Figma plugin from the CLI");
  console.log("");
  console.log("Usage: figmacode <command> [args]");
  console.log("");
  console.log("Commands:");
  console.log("  auth <token>                              Authenticate with a session token");
  console.log("  generate <selection|url|node-id> [out]    Export design -> HTML/JSX (out .jsx/.tsx = component)");
  console.log("  pages                                     List all pages + top-level frames in the file");
  console.log("  tree [out.md] [--single]                  Generate a markdown sections grid (--single = no AI splitting)");
  console.log("  run <file> <json|gen|resp|aggregate|all> [idx] [--single]  Run a pipeline stage for a section");
  console.log("  eval <code> [--out file]                  Run JS in the Figma sandbox, return JSON");
  console.log("  --help                                    Show this help");
  console.log("");
  console.log("Examples:");
  console.log('  npx -y figmacode auth <token>');
  console.log('  npx -y figmacode generate selection index.html');
  console.log('  npx -y figmacode generate 355-1581 out.html');
  console.log('  npx -y figmacode generate "https://www.figma.com/design/.../?node-id=355-1581" out.html');
  console.log('  npx -y figmacode pages');
  console.log('  npx -y figmacode eval "figma.currentPage.name"');
  console.log("");
  console.log("Requires the Figma plugin (CodeConvert) to be open. Config stored at ~/.cc/config.json");
};

if (!cmd || cmd === "--help" || cmd === "-h") { printHelp(); process.exit(0); }

if (cmd === "auth") {
  const token = process.argv[3];
  if (!token) { console.error("[CC] Token required"); process.exitCode = 1; process.exit(0); }
  try {
    const user = await client.query("auth:validate", { token });
    if (!user) { console.error("[CC] Invalid token"); process.exitCode = 1; process.exit(0); }
    writeConfig({ token, userId: user.id });
    console.log(`[CC] Authenticated as ${user.figmaUser?.name || user.id}`);
  } catch (e) { console.error("[CC] Auth failed:", e.message); process.exitCode = 1; }
  process.exit(0);
}

const parseNodeRef = s => {                                                             // figma url | 355-1581 | 355:1581 -> "355:1581" | null
  const m = s.match(/node-id=([^&\s]+)/);                                               // pull node-id param from a figma url
  const id = (m ? decodeURIComponent(m[1]) : s).trim().replace(/-/g, ":");              // figma urls encode ':' as '-'
  return /^I?\d+:\d+/.test(id) ? id : null;                                             // valid node id else null
};

if (cmd === "generate") {
  const cfg = authGuard(); if (!cfg) process.exit(0);
  const ref = process.argv[3];
  const outFile = process.argv[4] || null;
  if (!ref) { console.error("[CC] Usage: cc generate <selection|url|node-id> [outfile]"); process.exitCode = 1; process.exit(0); }
  const nodeId = ref === "selection" ? null : parseNodeRef(ref);                        // null = current selection
  if (ref !== "selection" && !nodeId) { console.error(`[CC] Invalid target: ${ref} (use 'selection', a figma url, or a node id like 355-1581)`); process.exitCode = 1; process.exit(0); }
  const format = outFile ? (outFile.endsWith(".jsx") || outFile.endsWith(".tsx") ? "component" : "react") : "react"; // .jsx/.tsx -> component, else static html
  const label = nodeId || "selection";
  try {
    const { requestId } = await client.mutation("action:submit", { token: cfg.token, type: "generate", code: JSON.stringify({ nodeId, format }) });
    process.stdout.write(`[CC] Generating ${label} -> ${format}`);
    const html = await fetchResultText(cfg.token, requestId);
    if (outFile) { writeFileSync(outFile, html); console.log(`[CC] Written to ${outFile} (${html.length} chars)`); }
    else console.log(html);
  } catch (e) { console.error("[CC] Generate failed:", e.message); process.exitCode = 1; }
  process.exit(0);
}

if (cmd === "pages") {
  const cfg = authGuard(); if (!cfg) process.exit(0);
  const code = "(async()=>{if(figma.loadAllPagesAsync)await figma.loadAllPagesAsync();return figma.root.children.map(p=>({id:p.id,name:p.name,current:p.id===figma.currentPage.id,frames:p.children.filter(n=>n.type==='FRAME').map(f=>({id:f.id,name:f.name}))}))})()"; // pages + top-level FRAME children
  try {
    const { requestId } = await client.mutation("action:submit", { token: cfg.token, type: "eval", code });
    process.stdout.write("[CC] Listing pages");
    const pages = await fetchResultJson(cfg.token, requestId);
    if (!Array.isArray(pages)) throw new Error("Unexpected result (is the plugin open?)");
    console.log(`[CC] ${pages.length} page(s):`);
    for (const p of pages) { // * marks current page; indent top-level frames beneath each page
      console.log(`  ${p.current ? "*" : " "} ${p.name}  (${p.id})`);
      for (const f of (p.frames || [])) console.log(`      - ${f.name}  (${f.id})`);
      if (!(p.frames || []).length) console.log("      (no top-level frames)");
    }
  } catch (e) { console.error("[CC] Pages failed:", e.message); process.exitCode = 1; }
  process.exit(0);
}

const nodeBBox = n => (
  n.absoluteBoundingBox ? { x: n.absoluteBoundingBox.x, y: n.absoluteBoundingBox.y, width: n.absoluteBoundingBox.width, height: n.absoluteBoundingBox.height }
    : (Number.isFinite(n.x) && Number.isFinite(n.y) ? { x: n.x, y: n.y, width: n.width || 0, height: n.height || 0 } : null)
);
const badName = /^(Frame \d+|Group \d+|Main Container|Container|Background Container?|Mask Group|Section|Content|Wrapper|Inner|Holder)$/i;
const hasTextContent = node => {
  if (!node || typeof node !== "object") return false;
  if (node.content || node.characters || node.textContent) return true;
  if (Array.isArray(node.children)) return node.children.some(hasTextContent);
  return false;
};
const enrichSectionTree = (node, rootBbox, depth = 0, maxDepth = 12) => {
  if (!node || typeof node !== "object") return null;
  const textContent = node.content || node.characters || node.textContent || "";
  const abs = nodeBBox(node);
  const bbox = abs && (depth <= 2 || textContent) ? [+(abs.x - (rootBbox?.x || 0)).toFixed(1), +(abs.y - (rootBbox?.y || 0)).toFixed(1), +abs.width.toFixed(1), +abs.height.toFixed(1)] : null;
  const name = depth <= 1 && !badName.test(node.name) ? node.name : null;
  const tc = textContent || null;
  let kids = null;
  if (depth < maxDepth && Array.isArray(node.children) && node.children.length) {
    let flat = depth === 0 ? [].concat(...node.children.map(c => c.type === "GROUP" && Array.isArray(c.children) ? c.children : [c])) : node.children;
    const filtered = flat.filter(c => hasTextContent(c));
    filtered.sort((a, b) => ((nodeBBox(a)?.y || 0) - (nodeBBox(b)?.y || 0)) || ((nodeBBox(a)?.x || 0) - (nodeBBox(b)?.x || 0)));
    const enriched = filtered.map(c => enrichSectionTree(c, rootBbox || abs, depth + 1, maxDepth)).filter(Boolean);
    let prevBottom = null;
    for (const kid of enriched) {
      const kb = kid[3];
      let gap = null;
      if (kb && prevBottom !== null) gap = +(kb[1] - prevBottom).toFixed(1);
      kid[6] = gap;
      if (kb) prevBottom = kb[1] + kb[3];
    }
    if (enriched.length) kids = enriched;
  }
  return [node.id, node.type, name, bbox, tc, kids, null];
};
const GEMINI_URL = "https://rare-newt-287.convex.site/gemini";
const CC_CACHE = join(process.cwd(), ".cc-cache");

// ---- CLI aggregate (mirror of home.jsx aggregateReact) ----
const sliceFns = src => {
  const out = [], re = /function\s+(\w+)\s*\([^)]*\)\s*\{/g; let m;
  while ((m = re.exec(src))) {
    let d = 1, i = re.lastIndex; for (; i < src.length && d; i++) d += (src[i] === "{") - (src[i] === "}");
    out.push({ name: m[1], body: src.slice(re.lastIndex, i - 1) }); re.lastIndex = i;
  }
  return out;
};
const stripReturn = b => {
  const r = b.match(/return\s*\(?\s*<(\w+)\s*\/?>?\s*\)?\s*;?\s*$/);
  return { decls: r ? b.slice(0, r.index).trim() : b.trim(), root: r?.[1] };
};
const unwrapReact = (decls, root) => {
  const fns = sliceFns(decls), rf = fns.find(f => f.name === root);
  const kids = rf ? [...rf.body.matchAll(/<(\w+)\s*\/>/g)].map(x => x[1]).filter(n => fns.some(f => f.name === n)) : [];
  const pure = rf && kids.length && /^\s*return\s*\(?\s*<>[\s\S]*<\/>\s*\)?\s*;?\s*$/.test(rf.body.trim());
  return pure ? kids.flatMap(n => { const s = stripReturn(fns.find(x => x.name === n).body); return unwrapReact(s.decls, s.root || root); })
    : [{ body: decls, root }];
};
const reactSectionMods = doc => {
  const babel = doc.match(/<script[^>]*type="text\/babel"[^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!babel) { console.error("[AGG] react section has no <script type=text/babel>"); return []; }
  const root = babel.match(/render\s*\(\s*<(\w+)/)?.[1];
  if (!root) { console.error("[AGG] react section has no render(<Root/>) call"); return []; }
  const decls = babel.replace(/ReactDOM[\s\S]*?render\s*\([\s\S]*?\)\s*;?/, "").trim();
  return unwrapReact(decls, root);
};
const aggregateReact = docs => {
  const tagRe = /<title[\s\S]*?<\/title>|<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>|<(?:meta|link|base)\b[^>]*?\/?>/gi;
  const seen = new Set();
  const allTags = docs.flatMap(d => (d.match(/<head[^>]*>([\s\S]*?)<\/head>/i)?.[1] || "").match(tagRe) || []);
  const fontFaceRe = /@font-face\{[^}]+\}/g;
  const fontFaces = new Set();
  allTags.forEach(t => { if (/id="figma-hosted-fonts"/.test(t)) { let m; while ((m = fontFaceRe.exec(t))) fontFaces.add(m[0]); } });
  const fontStyle = fontFaces.size
    ? `<style id="figma-hosted-fonts">\n      ${[...fontFaces].join("\n      ")}\n    </style>`
    : "";
  const head = [...allTags].filter(t => {
    if (!t) return false;
    if (/id="figma-hosted-fonts"/.test(t)) return false;
    if (/<title[\s\S]*?<\/title>/i.test(t)) { if (seen.has("__title__")) return false; seen.add("__title__"); }
    const k = t.replace(/\s+/g, " ").trim();
    return seen.has(k) ? false : seen.add(k);
  });
  if (fontStyle) head.unshift(fontStyle);
  const headStr = head.join("\n");
  const mods = docs.flatMap(reactSectionMods);
  const defs = mods.map((m, i) => `function Section${i}() {\n${m.body}\nreturn <${m.root} />;\n}`).join("\n\n");
  const uses = mods.map((_, i) => `      <Section${i} />`).join("\n");
  return `<!DOCTYPE html>\n<html lang="en">\n<head>\n${headStr}\n</head>\n<body class="m-0 overflow-auto bg-[#f5f5f5] relative">\n<div id="root"></div>\n<script type="text/babel">\n${defs}\n\nfunction App() {\n  return (\n    <>\n${uses}\n    </>\n  );\n}\nReactDOM.createRoot(document.getElementById('root')).render(<App />);\n</script>\n</body>\n</html>`;
};

const writeSectionsMd = (file, sections) => {
  const raw = readFileSync(file, "utf-8");
  const w = 30;
  const pre = raw.replace(/<!-- tree:[\s\S]*$/s, `<!-- tree: ${JSON.stringify(sections)} -->\n\n`);
  let md = pre;
  md += `| ${"Section".padEnd(w)} | JSON | GEN | RESP |\n`;
  md += `| ${"-".repeat(w)} | --- | --- | --- |\n`;
  for (const s of sections) {
    const lbl = s.label.replace(/\|/g, "&#124;").slice(0, w).padEnd(w);
    const j = s.state.json ? "[x]" : "[ ]";
    const g = s.state.gen ? "[x]" : "[ ]";
    const r = s.state.resp ? "[x]" : "[ ]";
    md += `| ${lbl} | ${j} | ${g} | ${r} |\n`;
  }
  writeFileSync(file, md);
};

const runStage = async (cfg, sections, idx, stage, singleSectionFlag = false) => {
  const s = sections[idx];
  if (stage === "aggregate") {
    const ready = sections.filter(x => x.state.gen);
    if (!ready.length) throw new Error("No sections have GEN output yet (run gen first)");
    const docs = ready.map((_, i) => {
      const p = join(CC_CACHE, `${i}.html`);
      if (!existsSync(p)) throw new Error(`Missing GEN output for section ${i} (${p})`);
      return readFileSync(p, "utf-8");
    });
    const out = aggregateReact(docs);
    if (!existsSync(CC_CACHE)) mkdirSync(CC_CACHE, { recursive: true });
    const aggPath = join(CC_CACHE, "sections.html");
    writeFileSync(aggPath, out);
    console.log(`\n[CC] Written aggregated ${aggPath} (${ready.length} sections)`);
    return;
  }
  if (stage === "json") {
    for (const nodeId of s.nodeIds || []) {
      const code = `(async()=>{const n=await figma.getNodeByIdAsync('${nodeId}');if(!n)return null;return{id:n.id,name:n.name,type:n.type}})()`;
      const { requestId } = await client.mutation("action:submit", { token: cfg.token, type: "eval", code });
      process.stdout.write(".");
      const content = await fetchResultJson(cfg.token, requestId);
      if (!existsSync(CC_CACHE)) mkdirSync(CC_CACHE, { recursive: true });
      const jsonPath = join(CC_CACHE, `${idx}.json`);
      writeFileSync(jsonPath, JSON.stringify(content));
      console.log(`\n[CC] Written ${jsonPath}`);
    }
    s.state.json = true;
  }
  if (stage === "gen") {
    const htmls = [];
    for (const nodeId of s.nodeIds || []) {
      const { requestId } = await client.mutation("action:submit", { token: cfg.token, type: "generate", code: JSON.stringify({ nodeId, format: "react", ...(singleSectionFlag ? { singleSection: true } : {}) }) });
      process.stdout.write(".");
      const html = await fetchResultText(cfg.token, requestId);
      htmls.push(html);
    }
    if (!existsSync(CC_CACHE)) mkdirSync(CC_CACHE, { recursive: true });
    const htmlPath = join(CC_CACHE, `${idx}.html`);
    if (htmls.length === 1) writeFileSync(htmlPath, htmls[0]);
    else {
      const combined = htmls.length ? htmls.join("\n") : "";
      writeFileSync(htmlPath, combined);
    }
    console.log(`\n[CC] Written ${htmlPath}`);
    s.state.gen = true;
  }
  if (stage === "resp") {
    const htmlPath = join(CC_CACHE, `${idx}.html`);
    if (!existsSync(htmlPath)) throw new Error(`GEN not yet run for section ${idx} (missing ${htmlPath})`);
    const html = readFileSync(htmlPath, "utf-8");
    process.stdout.write(".");
    const geminiRes = await fetch(GEMINI_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "responsive", html, renderMode: "react" }) });
    if (!geminiRes.ok) { const txt = await geminiRes.text(); throw new Error(`Gemini ${geminiRes.status}: ${txt.slice(0, 200)}`); }
    const rawText = await geminiRes.text();
    const body = JSON.parse(rawText);
    const inner = body.text || rawText;
    const fenced = inner.replace(/^```(?:html|jsx|tsx|javascript|js)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const respPath = join(CC_CACHE, `${idx}-resp.html`);
    if (/<\/html>/i.test(fenced)) {
      // Full HTML document from Gemini — use directly
      writeFileSync(respPath, fenced);
    } else {
      // Gemini returned component source — extract JSX
      let jsx = fenced;
      // Strip function App() { return ( ... ) } wrapper if present
      const fnStart = fenced.match(/function\s+\w+\s*\(\)\s*\{[\s\S]*?return\s*\(/);
      if (fnStart) {
        const body = fenced.slice(fnStart.index + fnStart[0].length);
        let depth = 1, i = 0;
        for (; i < body.length && depth > 0; i++) {
          if (body[i] === '(') depth++;
          if (body[i] === ')') depth--;
        }
        jsx = body.slice(0, i - 1).trim();                       // up to matching close paren
      }
      const fragMatch = jsx.match(/(<>[\s\S]*?<\/>)/s);
      if (fragMatch) jsx = fragMatch[1];
      const injected = html.replace(/(<>)\s*([\s\S]*?)\s*(<\/>)/s, (_, o, __, c) => `${o}\n${jsx}\n${c}`);
      writeFileSync(respPath, injected);
    }
    console.log(`\n[CC] Written ${respPath}`);
    s.state.resp = true;
  }
};

if (cmd === "tree") {
  const cfg = authGuard(); if (!cfg) process.exit(0);
  const treeArgs = process.argv.slice(3);
  const singleTree = treeArgs.includes("--single");
  const outFile = treeArgs.filter(a => a !== "--single")[0] || "sections.md";
  const evalCode = `(()=>{const s=figma.currentPage.selection[0];if(!s)return null;return(function w(n){return{id:n.id,type:n.type,name:n.name,...(n.absoluteBoundingBox?{absoluteBoundingBox:{x:n.absoluteBoundingBox.x,y:n.absoluteBoundingBox.y,width:n.absoluteBoundingBox.width,height:n.absoluteBoundingBox.height}}:{}),...(n.type==='TEXT'?{characters:n.characters}:{}),children:Array.isArray(n.children)?n.children.map(w):[]}})(s)})()`;
  try {
    const { requestId } = await client.mutation("action:submit", { token: cfg.token, type: "eval", code: evalCode });
    process.stdout.write("[CC] Fetching tree");
    let rawTree;
    try { rawTree = await fetchResultText(cfg.token, requestId); } catch (e) { console.error("\n[CC] Tree fetch failed:", e.message); throw e; }
    console.log();
    let tree;
    try { tree = JSON.parse(rawTree); } catch (e) { console.error(`[CC] Invalid tree JSON (${rawTree.slice(0, 200)}):`, e.message); throw e; }
    if (!tree) { console.error("[CC] No selection in Figma"); process.exitCode = 1; process.exit(0); }

    let sections;
    if (singleTree) {
      sections = tree?.id ? [{ label: tree?.name || "Selection", nodeIds: [tree.id] }] : [];
      console.log(`\n[CC] Single section mode (no AI splitting)`);
    } else {
      const nodeYMap = new Map();
      (function walk(n, p) {
        if (n?.id) {
          nodeYMap.set(n.id, (n.absoluteBoundingBox?.y ?? n.y ?? 0));
          n.children?.forEach(c => walk(c, n.id));
        }
      })(tree, null);
      const enriched = enrichSectionTree(tree);
      process.stdout.write("[CC] Analyzing sections");
      const geminiRes = await fetch(GEMINI_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "sections", tree: enriched }) });
      if (!geminiRes.ok) { const txt = await geminiRes.text(); throw new Error(`Gemini proxy ${geminiRes.status}: ${txt.slice(0, 200)}`); }
      const rawText = await geminiRes.text();
      if (!rawText) throw new Error("Gemini returned empty response");
      const body = JSON.parse(rawText);
      const inner = body.text || rawText;
      const json = inner.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
      if (!json) throw new Error("Gemini returned empty response after unwrap");
      const parsed = JSON.parse(json);
      // descendant map: nodeId -> parent id (selection tree)
      const descendantsOf = new Map();
      (function index(n) {
        if (!n?.id || !Array.isArray(n.children)) return;
        for (const c of n.children) { descendantsOf.set(c.id, n.id); index(c); }
      })(tree);
      const isDescendantOf = (id, ancestor) => { let p = descendantsOf.get(id); while (p) { if (p === ancestor) return true; p = descendantsOf.get(p); } return false; };
      // collect candidates, then drop any section that is a descendant (child/grandchild) of ANOTHER section (order-independent)
      const claimed = new Set();
      const parsed2 = [];
      for (const s of (parsed.sections || [])) {
        const ids = s.nodeIds || (s.nodeId ? [s.nodeId] : []);
        const rawId = ids[0];
        if (!rawId || claimed.has(rawId)) continue;                              // skip empties + exact dups
        claimed.add(rawId);
        parsed2.push({ label: s.label, nodeIds: [rawId] });
      }
      const clean = parsed2.filter(a => !parsed2.some(b => b !== a && isDescendantOf(a.nodeIds[0], b.nodeIds[0]))); // keep only top-level sections
      clean.sort((a, b) => (nodeYMap.get(a.nodeIds[0]) || 0) - (nodeYMap.get(b.nodeIds[0]) || 0));
      sections = clean.length ? clean : (tree?.id ? [{ label: tree?.name || "Selection", nodeIds: [tree.id] }] : []);
    }

    console.log(`[CC] ${sections.length} section(s)`);
    const data = sections.map(s => ({ label: s.label, nodeIds: s.nodeIds, state: { json: false, gen: false, resp: false } }));
    const w = 30;
    let md = `# Sections Grid\n\nGenerated: ${new Date().toISOString().slice(0, 10)}\n\n<!-- tree: ${JSON.stringify(data)} -->\n\n`;
    md += `| ${"Section".padEnd(w)} | JSON | GEN | RESP |\n`;
    md += `| ${"-".repeat(w)} | --- | --- | --- |\n`;
    for (const s of data) {
      const lbl = s.label.replace(/\|/g, "&#124;").slice(0, w).padEnd(w);
      md += `| ${lbl} | [ ] | [ ] | [ ] |\n`;
    }

    writeFileSync(outFile, md);
    console.log(`[CC] Written to ${outFile} (${sections.length} sections)`);
  } catch (e) { console.error("\n[CC] Sections failed:", e.message); process.exitCode = 1; }
  process.exit(0);
}

if (cmd === "run") {
  const cfg = authGuard(); if (!cfg) process.exit(0);
  const runArgs = process.argv.slice(3);
  const singleRun = runArgs.includes("--single");
  const cleanRunArgs = runArgs.filter(a => a !== "--single");
  const sectionsFile = cleanRunArgs[0] || "sections.md";
  const sections = (() => {
    const raw = readFileSync(sectionsFile, "utf-8");
    const m = raw.match(/<!-- tree:\s*(\[.*?\])\s*-->/);
    if (!m) throw new Error("No tree metadata in " + sectionsFile);
    return JSON.parse(m[1]);
  })();
  const stage = cleanRunArgs[1];
  const idx = parseInt(cleanRunArgs[2], 10);
  if (stage === "all") {
    for (let i = 0; i < sections.length; i++) {
      for (const s of ["json", "gen", "resp"]) {
        process.stdout.write(`\n[CC] Section ${i} ${s}`);
        await runStage(cfg, sections, i, s, singleRun);
        process.stdout.write(" done");
      }
    }
    process.stdout.write("\n[CC] Aggregating");
    await runStage(cfg, sections, -1, "aggregate", singleRun);
    writeSectionsMd(sectionsFile, sections);
    console.log(`\n[CC] All sections complete`);
    process.exit(0);
  }
  if (!["json", "gen", "resp", "aggregate"].includes(stage) || (!Number.isNaN(idx) && (stage !== "aggregate" && (idx < 0 || idx >= sections.length)))) {
    console.error(`[CC] Usage: cc run <sections.md> <json|gen|resp|aggregate|all> [index]`);
    console.error(`[CC]        cc run <sections.md> all`);
    process.exitCode = 1; process.exit(0);
  }
  await runStage(cfg, sections, idx, stage, singleRun);
  writeSectionsMd(sectionsFile, sections);
  console.log(`[CC] Updated ${sectionsFile}`);
  process.exit(0);
}

if (cmd === "eval") {
  const cfg = authGuard(); if (!cfg) process.exit(0);
  const outIdx = process.argv.indexOf("--out"); const outFile = outIdx > -1 ? process.argv[outIdx + 1] : null;
  const code = outIdx > -1 ? process.argv.slice(3, outIdx).join(" ") : arg;
  if (!code) { console.error("[CC] Code argument required"); process.exitCode = 1; process.exit(0); }
  try {
    const { requestId } = await client.mutation("action:submit", { token: cfg.token, type: "eval", code });
    process.stdout.write("[CC] Waiting");
    const content = await fetchResultJson(cfg.token, requestId);
    if (outFile) { writeFileSync(outFile, JSON.stringify(content, null, 2)); console.log(`[CC] Written to ${outFile}`); }
    else console.log("[CC] Result:", content);
  } catch (e) { console.error("[CC] Eval failed:", e.message); process.exitCode = 1; }
  process.exit(0);
}

console.error(`[CC] Unknown command: ${cmd}`);
process.exitCode = 1;
