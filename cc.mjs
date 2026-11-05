#!/usr/bin/env node
// scripts/remote-eval.mjs — CLI client for the realtime remote-eval transport.
// Posts a JS snippet as `user:<uid>:eval:<reqId>` to origincc and awaits the
// result the Figma plugin writes back (see frontend/src/lib/remote-eval.js).
//
//   ORIGIN_URL=https://codeconvert.cc ACCESS_TOKEN=<jwt> \
//     node scripts/remote-eval.mjs --code "figma.currentPage.name" [--args '{"a":1}'] [--timeout 60000]
//
//   ACCESS_TOKEN=<jwt|cct_…> node cc.mjs json [--node <nodeId>] --out <path>
//     Runs the getNodeJson stage (frontend/src/procedure/3.json.js) remotely,
//     saves the dump to <path>, and prints the saved filepath.
//     Default node = current selection[0].node-id style (2276-5825) and
//     colon style (2276:5825) are both accepted.
//
// The JWT comes from POST /auth/signin { machineId } — but prefer the short
// `cct_…` access token from the signin response's `user.accessToken`
// (typable, stable across signins; rotate via POST /api/token/rotate).
// USER_ID is derived from either credential's identity (JWT `sub`, or the
// access-token index) — set USER_ID explicitly only to target a
// different uid (admins). Exit 0 + prints JSON result; exit 1 + prints error.

import { randomUUID } from 'node:crypto';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { RealtimeClient } from '@prsm/realtime/client';
import { resolveToken, saveToken, deleteSavedToken } from './src/token.js';

const ORIGIN = (process.env.ORIGIN_URL || 'https://codeconvert.cc').replace(/\/$/, '');

/**
 * User id is already in the JWT (`sub` claim, see origincc
 * backend/lib/jwt.js signToken) — no separate lookup needed. Short access
 * tokens (`cct_…`, no dots) carry no identity locally; those resolve via
 * the server's `auth/me` command after connecting (needs a client).
 * @param {string} token - JWT or short access token.
 * @param {import('@prsm/realtime/client').RealtimeClient|null} [client] - connected client (required for short tokens).
 */
async function userIdFromToken(token, client = null) {
  const parts = String(token).split('.');
  if (parts.length !== 3) {
    if (!client) throw new Error('remote-eval: short access token needs USER_ID/--user (or a connection to resolve it)');
    const me = await client.command('auth/me');
    const id = me?.user?.id;
    if (!id) throw new Error('remote-eval: auth/me returned no user.id');
    return String(id).replace(/^user:/, '');
  }
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (!payload.sub) throw new Error('remote-eval: token has no sub claim');
  return String(payload.sub).replace(/^user:/, '');
}

// ─── json / html / react subcommands ────────────────────────────
// remote-eval exec (frontend/src/lib/remote-eval.js) has kind:getNodeJson /
// kind:generateHtml / kind:presentationHtml shortcuts: cc.mjs posts
// { kind, args:{nodeId} } and the webview calls its own modules directly —
// getNodeJson, then normalizeNodeJson + generateHtml, the processFactory
// json→normalize→html chain (evalHost hop inside getNodeJson).
// `react` returns the raw generateHtml stage output (React component JSX).
// `html` returns the presentation stage output: that component wrapped in
// buildPresentationShell (presentation.js) — the full HTML document the
// in-app preview shows (babel+tailwind, React UMD, font head markup).
// `screenshot` exports the node's own Figma render as a PNG
// (node.exportAsync in the plugin) — ground truth to compare the generated
// HTML render against. No remote-eval kind needed: it's a plain eval whose
// result is a base64 PNG the CLI decodes to --out.

function showHelp() {
  console.log(`figmacode — CLI and MCP server for Figma to Code

USAGE:
  figmacode <command> [options]

COMMANDS:
  react                 Convert selection (or --node <id>) to React JSX with Tailwind CSS
  html                  Generate standalone preview HTML document
  screenshot, snap      Export pixel-accurate PNG render of selected node
  json                  Export normalized Figma scene tree JSON
  search <query>, find  Search layers across pages by name or text content
  eval "<code>"         Evaluate arbitrary JavaScript in the Figma plugin sandbox
  mcp                   Start the Model Context Protocol (MCP) stdio server

OPTIONS:
  --node <id>           Target Figma node ID (e.g. 12:345). Defaults to current selection
  --out <path>          Output file path (required for react, html, json, screenshot)
  --no-media            Disable image extraction & CDN upload (keeps inline data URIs)
  --graphics <mode>     Graphics rendering mode: "vector" (SVG) or "raster" (retina PNG)
  --type <type>         Filter by node type in search (FRAME, TEXT, COMPONENT, etc.)
  --limit <n>           Max search results to return (default: 20)
  --page-only, --current Limit search to current page only (default: all pages)
  --token <cct_...>     CodeConvert Developer Access Token (saved automatically)
  --timeout <ms>        Request timeout in ms (default: 60000)
  --url <wss://...>     WebSocket endpoint (default: wss://codeconvert.cc)
  --delete              Delete realtime eval record from server after completion
  --help, -h            Show this help message

EXAMPLES:
  figmacode react --out ./Button.jsx
  figmacode html --node 12:345 --out ./preview.html
  figmacode screenshot --out ./screen.png
  figmacode search "dropdown"
  figmacode eval "figma.currentPage.name"
  figmacode mcp
`);
  process.exit(0);
}

const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
}
if (opt.help || opt.h || argv.length === 0 || argv[0] === 'help' || argv[0] === '--help' || argv[0] === '-h') {
  showHelp();
}
if (argv[0] === 'mcp') {
  await import('./mcp.mjs');
} else {
  const isJsonCmd = argv[0] === 'json';
  const isReactCmd = argv[0] === 'react' || argv[0] === 'media';
  const isHtmlCmd = argv[0] === 'html';
  const isShotCmd = argv[0] === 'screenshot' || argv[0] === 'snap';
  const isSearchCmd = argv[0] === 'search' || argv[0] === 'find';
  const isStageCmd = isJsonCmd || isReactCmd || isHtmlCmd || isShotCmd;
  const withMedia = !opt['no-media'];
  const isEvalCmd = argv[0] === 'eval';
    function usage(msg) {
    if (msg) console.error(`Error: ${msg}\n`);
    console.error('Usage: figmacode (eval "<code>" | react | html | screenshot | json | search "<query>" | mcp) [options]');
    console.error('Run "figmacode --help" for detailed documentation and examples.');
    process.exit(2);
  }
  const cliUser = (opt.user || process.env.USER_ID || '').replace(/^user:/, '');
  let CODE;
  let stageOut = null;
  let stageNodeId = null;
  let searchWord = null;
  if (isSearchCmd) {
    searchWord = argv[1] && !argv[1].startsWith('--') ? argv[1] : opt.query;
    if (!searchWord) usage('Missing search query. Example: figmacode search "dropdown"');
    const qStr = JSON.stringify(String(searchWord).toLowerCase());
    const tStr = JSON.stringify(opt.type ? String(opt.type).toUpperCase() : null);
    const lNum = Math.min(Math.max(1, Number(opt.limit) || 20), 100);
    const apBool = !opt['page-only'] && !opt.current;

    CODE = `(async () => {
      const query = ${qStr};
      const targetType = ${tStr};
      const limit = ${lNum};
      const allPages = ${apBool};

      if (allPages) {
        try { await figma.loadAllPagesAsync(); } catch (_) {}
      }

      function getScreen(node) {
        let curr = node;
        let top = null;
        while (curr && curr.parent && curr.parent.type !== 'PAGE' && curr.parent.type !== 'DOCUMENT') {
          curr = curr.parent;
          if (curr.type === 'FRAME' || curr.type === 'COMPONENT' || curr.type === 'SECTION') {
            top = curr;
          }
        }
        return top ? { id: top.id, name: top.name, type: top.type } : null;
      }

      const pages = allPages ? figma.root.children.filter(p => p.type === 'PAGE') : [figma.currentPage];
      const results = [];

      for (const page of pages) {
        if (results.length >= limit) break;
        try {
          if (typeof page.loadAsync === 'function') await page.loadAsync();
        } catch (_) {}

        const matches = page.findAll(n => {
          if (targetType && n.type !== targetType) return false;
          const nameMatch = n.name && n.name.toLowerCase().includes(query);
          const textMatch = n.type === 'TEXT' && n.characters && n.characters.toLowerCase().includes(query);
          return nameMatch || textMatch;
        });

        for (const m of matches) {
          if (results.length >= limit) break;
          results.push({
            id: m.id,
            name: m.name,
            type: m.type,
            text: m.type === 'TEXT' ? m.characters : undefined,
            page: page.name,
            screen: getScreen(m),
            bounds: {
              x: Math.round(m.x),
              y: Math.round(m.y),
              width: Math.round(m.width),
              height: Math.round(m.height),
            },
          });
        }
      }

      return results;
    })()`;
  } else if (isStageCmd) {
    stageOut = typeof opt.out === 'string' ? opt.out : null;
    stageNodeId = typeof opt.node === 'string' ? opt.node : null;
    if (!stageOut) usage(`Missing required --out flag for "${argv[0]}". Example: figmacode ${argv[0]} --out ./output`);
    if (isShotCmd) {
      // figma.exportAsync PNG of the node (or selection). nodeId embedded as a
      // literal — the plugin's host:eval handler ignores message.args.
      const shotId = stageNodeId ? String(stageNodeId).replace(/-/g, ':') : null;
      CODE = `(async () => {
    const nodeId = ${JSON.stringify(shotId)};
    const n = nodeId ? await figma.getNodeByIdAsync(nodeId) : figma.currentPage.selection?.[0];
    if (!n) throw new Error('screenshot: node not found');
    const bytes = await n.exportAsync({ format: 'PNG' });
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return { name: n.name, id: n.id, w: n.width, h: n.height, b64: btoa(bin) };
  })()`;
    } else {
      CODE = isHtmlCmd ? 'presentationHtml' : isReactCmd ? 'generateHtml' : 'getNodeJson';
    }
  } else {
    CODE = (isEvalCmd && !argv[1]?.startsWith('--') ? argv[1] : null) || opt.eval || opt.code;
    if (!CODE) usage('Command or JavaScript code required to evaluate.');
  }
  const cliToken = typeof opt.token === 'string' ? opt.token : null;
  const TOKEN = await resolveToken({ token: cliToken, interactive: true });
  if (!TOKEN) {
    console.error('\nNo access token provided.');
    console.error('Set $env:ACCESS_TOKEN="cct_...", pass --token <token>, or enter it when prompted.');
    process.exit(2);
  }
  const TIMEOUT = Number(opt.timeout || (isStageCmd ? 120000 : 60000));
  const WS_URL = (opt.url || ORIGIN.replace(/^http/, 'ws')).replace(/\/$/, '');

  const client = new RealtimeClient(`${WS_URL}?token=${encodeURIComponent(TOKEN)}`, { shouldReconnect: false });
  try {
    await client.connect();
    saveToken(TOKEN);
  } catch (err) {
    deleteSavedToken();
    console.error(`\n[figmacode] Connection failed: unable to connect to ${WS_URL}`);
    console.error(`Authentication was rejected or the server is unreachable (${err?.message || err}).`);
    console.error(`Tip: Ensure the CodeConvert plugin is open in Figma, then copy a fresh Developer Token from its header menu:`);
    console.error(`  figmacode --token "cct_..."\n`);
    process.exit(1);
  }

  // Identity: explicit --user wins, else JWT `sub`, else auth/me (short tokens).
  const USER_ID = cliUser || (await userIdFromToken(TOKEN, client));
  const reqId = randomUUID();
  const recordId = `user:${USER_ID}:eval:${reqId}`;
  const graphicsOpt = opt.graphics || (opt.raster ? 'raster' : opt.vector ? 'vector' : undefined);
  const args = isStageCmd
    ? { nodeId: stageNodeId ? String(stageNodeId).replace(/-/g, ':') : null, media: withMedia, ...(graphicsOpt ? { graphics: graphicsOpt } : {}) }
    : (opt.args ? JSON.parse(opt.args) : undefined);
  const record = { id: recordId, status: 'pending', code: CODE, args, createdAt: Date.now() };
  if (isHtmlCmd) record.kind = 'presentationHtml';
  else if (isReactCmd) record.kind = 'generateHtml';
  else if (isJsonCmd) record.kind = 'getNodeJson';

  const ok = await client.writeRecord(recordId, record);
  if (!ok) throw new Error(`remote-eval: write ${recordId} rejected (check token/user)`);
  console.error(`[remote-eval] posted ${recordId}`);

  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`remote-eval timed out after ${TIMEOUT}ms (is the plugin open?)`)), TIMEOUT);
    client.subscribeRecord(recordId, (update) => {
      const rec = update.full;
      if (rec && rec.status === 'done') {
        clearTimeout(timer);
        resolve(rec);
      }
    }).then((sub) => {
      if (sub?.record?.status === 'done') {
        clearTimeout(timer);
        resolve(sub.record);
      }
    }).catch(reject);
  });

  if (opt.delete) {
    try { await client.transaction([{ op: 'delete', recordId }]); } catch {}
  }
  try { client.close(); } catch {}

  if (result.error) {
    console.error(`[remote-eval] error: ${result.error}`);
    process.exit(1);
  }
  if (isSearchCmd) {
    const list = Array.isArray(result.result) ? result.result : [];
    if (opt.out) {
      const outPath = resolve(opt.out);
      mkdirSync(dirname(outPath), { recursive: true });
      writeFileSync(outPath, JSON.stringify(list, null, 2));
      console.log(outPath);
      process.exit(0);
    }
    if (opt.json) {
      console.log(JSON.stringify(list, null, 2));
    } else {
      if (!list.length) {
        console.log(`No layers found matching "${searchWord}".`);
      } else {
        console.log(`Found ${list.length} layer(s) matching "${searchWord}":`);
        for (const item of list) {
          const screen = item.screen ? ` [Screen: ${item.screen.name} (${item.screen.id})]` : '';
          const preview = item.text ? ` - "${item.text.replace(/\s+/g, ' ').slice(0, 50)}"` : '';
          console.log(` • [${item.id}] ${item.name} <${item.type}> on "${item.page}"${screen}${preview}`);
        }
      }
    }
    process.exit(0);
  }
  if (isStageCmd) {
    const outPath = resolve(stageOut);
    mkdirSync(dirname(outPath), { recursive: true });
    // html: result IS the presentation HTML document string — write it.
    // react: stage output object — --out *.json saves it whole, otherwise
    // save the generated component source (`result.html`) as-is.
    // json: full dump JSON.
    if (isShotCmd) {
      const b64 = result.result?.b64;
      if (!b64) throw new Error('screenshot: no PNG data returned');
      writeFileSync(outPath, Buffer.from(b64, 'base64'));
      console.log(outPath);
      process.exit(0);
    }
    let text;
    if (isHtmlCmd) text = String(result.result ?? '');
    else if (isReactCmd && !/\.json$/i.test(outPath) && typeof result.result?.html === 'string') text = result.result.html;
    else text = JSON.stringify(result.result ?? null, null, 2);
    writeFileSync(outPath, text);
    console.log(outPath);
    process.exit(0);
  }
  console.log(JSON.stringify(result.result ?? null));
  process.exit(0);
}
