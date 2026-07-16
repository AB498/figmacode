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
  console.log("  tree [out.md]                             Generate a markdown sections grid with checkboxes");
  console.log("  run <file> <json|gen|resp|all> [idx]      Run a pipeline stage for a section");
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

const runStage = async (cfg, sections, idx, stage) => {
  const s = sections[idx];
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
      const { requestId } = await client.mutation("action:submit", { token: cfg.token, type: "generate", code: JSON.stringify({ nodeId, format: "react" }) });
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
    const fragment = inner.replace(/^```(?:html|jsx|tsx|javascript|js)?\s*/i, "").replace(/```\s*$/i, "").trim();
    const respPath = join(CC_CACHE, `${idx}-resp.html`);
    const injected = html.replace(
      /(return\s*\()\s*(<>[\s\S]*?<\/>)\s*(\);)/,
      (_, pre, _mid, post) => `${pre}\n${fragment}\n${post}`
    );
    writeFileSync(respPath, injected === html ? (fragment || inner) : injected);
    console.log(`\n[CC] Written ${respPath}`);
    s.state.resp = true;
  }
};

if (cmd === "tree") {
  const cfg = authGuard(); if (!cfg) process.exit(0);
  const outFile = process.argv[3] ? process.argv[3] : "sections.md";
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
    const parentMap = new Map(); const containerSet = new Set(); const nodeYMap = new Map();
    (function walk(n, p) {
      if (n?.id) {
        if (p) parentMap.set(n.id, p);
        if (n?.children?.length && p === tree?.id) containerSet.add(n.id);
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
    const claimed = new Set();
    const clean = (parsed.sections || []).map(s => {
      const ids = s.nodeIds || (s.nodeId ? [s.nodeId] : []);
      for (const rawId of ids) {
        let cur = rawId;
        while (cur) {
          if (cur === tree?.id) {
            if (!claimed.has(cur)) { claimed.add(cur); return { label: s.label, nodeIds: [cur] }; }
            break;
          }
          cur = parentMap.get(cur);
        }
      }
      return null;
    }).filter(Boolean);
    clean.sort((a, b) => (nodeYMap.get(a.nodeIds[0]) || 0) - (nodeYMap.get(b.nodeIds[0]) || 0));
    const sections = clean.length ? clean : (tree?.id ? [{ label: tree?.name || "Selection", nodeIds: [tree.id] }] : []);
    console.log(`\n[CC] ${sections.length} section(s)`);

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
  const sectionsFile = process.argv[3] ? process.argv[3] : "sections.md";
  const sections = (() => {
    const raw = readFileSync(sectionsFile, "utf-8");
    const m = raw.match(/<!-- tree:\s*(\[.*?\])\s*-->/);
    if (!m) throw new Error("No tree metadata in " + sectionsFile);
    return JSON.parse(m[1]);
  })();
  const stage = process.argv[4];
  const idx = parseInt(process.argv[5], 10);
  if (stage === "all") {
    for (let i = 0; i < sections.length; i++) {
      for (const s of ["json", "gen", "resp"]) {
        process.stdout.write(`\n[CC] Section ${i} ${s}`);
        await runStage(cfg, sections, i, s);
        process.stdout.write(" done");
      }
    }
    writeSectionsMd(sectionsFile, sections);
    console.log(`\n[CC] All sections complete`);
    process.exit(0);
  }
  if (!["json", "gen", "resp"].includes(stage) || isNaN(idx) || idx < 0 || idx >= sections.length) {
    console.error(`[CC] Usage: cc run <sections.md> <json|gen|resp|all> [index]`);
    console.error(`[CC]        cc run <sections.md> all`);
    process.exitCode = 1; process.exit(0);
  }
  await runStage(cfg, sections, idx, stage);
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
