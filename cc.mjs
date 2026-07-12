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
    process.stdout.write(".");
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

if (!cmd) {
  console.log("Commands:");
  console.log("  auth <token>                    Authenticate with session token");
  console.log("  generate <selection|page> [out] Export design from the Figma plugin");
  console.log("  pages                           List all pages in the Figma file");
  console.log("  eval <code> [--out file]        Run eval code in the Figma plugin");
  process.exit(0);
}

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

if (cmd === "generate") {
  const cfg = authGuard(); if (!cfg) process.exit(0);
  const target = process.argv[3];
  const outFile = process.argv[4] || null;
  if (!["selection", "page"].includes(target)) { console.error("[CC] Usage: cc generate <selection|page> [outfile]"); process.exitCode = 1; process.exit(0); }
  const format = outFile ? (outFile.endsWith(".jsx") || outFile.endsWith(".tsx") ? "component" : "react") : "react"; // .jsx/.tsx -> component, else static html
  try {
    const { requestId } = await client.mutation("action:submit", { token: cfg.token, type: "generate", code: JSON.stringify({ target, format }) });
    process.stdout.write(`[CC] Generating ${target} -> ${format}`);
    const html = await fetchResultText(cfg.token, requestId);
    if (outFile) { writeFileSync(outFile, html); console.log(`[CC] Written to ${outFile} (${html.length} chars)`); }
    else console.log(html);
  } catch (e) { console.error("[CC] Generate failed:", e.message); process.exitCode = 1; }
  process.exit(0);
}

if (cmd === "pages") {
  const cfg = authGuard(); if (!cfg) process.exit(0);
  const code = "(async()=>{if(figma.loadAllPagesAsync)await figma.loadAllPagesAsync();return figma.root.children.map(p=>({id:p.id,name:p.name,current:p.id===figma.currentPage.id}))})()"; // pages = figma.root.children
  try {
    const { requestId } = await client.mutation("action:submit", { token: cfg.token, type: "eval", code });
    process.stdout.write("[CC] Listing pages");
    const pages = await fetchResultJson(cfg.token, requestId);
    if (!Array.isArray(pages)) throw new Error("Unexpected result (is the plugin open?)");
    console.log(`[CC] ${pages.length} page(s):`);
    for (const p of pages) console.log(`  ${p.current ? "*" : " "} ${p.name}  (${p.id})`); // * marks current page
  } catch (e) { console.error("[CC] Pages failed:", e.message); process.exitCode = 1; }
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
