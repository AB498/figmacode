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

const waitForResult = async (requestId, timeout = 120000) => {
  for (let ms = 0; ms < timeout; ms += 500) {
    await new Promise(r => setTimeout(r, 500));
    const res = await client.mutation("actions:getResult", { requestId });
    if (!res) continue;
    return res;
  }
  throw new Error("Timed out waiting for result");
};

if (!cmd) {
  console.log("Commands:");
  console.log("  auth <token>        Authenticate with session token");
  console.log("  eval <code>         Run eval code in the Figma plugin");
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

if (cmd === "eval") {
  const cfg = authGuard(); if (!cfg) process.exit(0);
  const outIdx = process.argv.indexOf("--out"); const outFile = outIdx > -1 ? process.argv[outIdx + 1] : null;
  const code = outIdx > -1 ? process.argv.slice(3, outIdx).join(" ") : arg;
  if (!code) { console.error("[CC] Code argument required"); process.exitCode = 1; process.exit(0); }
  try {
    const { requestId } = await client.mutation("actions:upsert", { token: cfg.token, type: "eval", code });
    process.stdout.write("[CC] Waiting");
    const res = await waitForResult(requestId);
    console.log();
    if (res.status === "failed") { console.error("[CC] Error:", res.error); process.exitCode = 1; }
    else if (outFile) {
      if (!res.storageUrl) { console.error("[CC] No result"); process.exitCode = 1; }
      else { const content = await fetch(res.storageUrl).then(r => { if (!r.ok) throw new Error(`Storage fetch ${r.status}`); return r.json(); }); writeFileSync(outFile, JSON.stringify(content, null, 2)); console.log(`[CC] Written to ${outFile}`); }
    } else { if (!res.storageUrl) { console.log("[CC] Result: null"); } else { const c = await fetch(res.storageUrl).then(r => r.json()); console.log("[CC] Result:", c); } }
  } catch (e) { console.error("[CC] Eval failed:", e.message); process.exitCode = 1; }
  process.exit(0);
}

console.error(`[CC] Unknown command: ${cmd}`);
process.exitCode = 1;
