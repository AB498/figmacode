// src/bridge.js — realtime transport bridge connecting to Figma plugin.
// Reuses the proven @prsm/realtime protocol from cc.mjs.
// Narrow contract: getSelection(), evalStage(), screenshot(), eval(), close().

import { randomUUID } from 'node:crypto';
import { RealtimeClient } from '@prsm/realtime/client';
import { readSavedToken } from './token.js';

/**
 * Extract or resolve user ID from JWT token or via auth/me command.
 * @param {string} token - JWT or short access token (cct_…)
 * @param {import('@prsm/realtime/client').RealtimeClient} client
 * @returns {Promise<string>}
 */
async function resolveUserId(token, client) {
  const parts = String(token).split('.');
  if (parts.length !== 3) {
    const me = await client.command('auth/me');
    const id = me?.user?.id;
    if (!id) throw new Error('remote-eval: auth/me returned no user.id. Ensure ACCESS_TOKEN is valid.');
    return String(id).replace(/^user:/, '');
  }
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (!payload.sub) throw new Error('remote-eval: token has no sub claim');
  return String(payload.sub).replace(/^user:/, '');
}

/**
 * Factory for the Figma Realtime Bridge client.
 *
 * @param {object} opts
 * @param {string} [opts.token] - Access token (ACCESS_TOKEN / ORIGIN_TOKEN)
 * @param {string} [opts.originUrl] - Base origin URL (default: https://codeconvert.cc)
 * @param {number} [opts.timeoutMs] - Evaluation timeout in ms (default: 60000)
 * @param {string} [opts.userId] - Optional explicit user ID
 * @returns {Promise<object>} plain bridge client object with narrow contract
 */
export async function createFigmaBridge(opts = {}) {
  const token = opts.token || process.env.ACCESS_TOKEN || process.env.ORIGIN_TOKEN || readSavedToken() || '';
  if (!token) {
    throw new Error('FigmaBridge: ACCESS_TOKEN required. Set ACCESS_TOKEN or run "figmacode" once in terminal to enter and save it.');
  }

  const origin = (opts.originUrl || process.env.ORIGIN_URL || 'https://codeconvert.cc').replace(/\/$/, '');
  const wsUrl = origin.replace(/^http/, 'ws');
  const timeoutMs = Number(opts.timeoutMs || 60000);

  const client = new RealtimeClient(`${wsUrl}?token=${encodeURIComponent(token)}`, { shouldReconnect: true });
  await client.connect();

  const userId = (opts.userId || process.env.USER_ID || '').replace(/^user:/, '') || (await resolveUserId(token, client));

  /**
   * Post an eval record and await response from the open Figma plugin.
   */
  async function postEvalRecord(payload, timeout = timeoutMs) {
    const reqId = randomUUID();
    const recordId = `user:${userId}:eval:${reqId}`;
    const record = {
      id: recordId,
      status: 'pending',
      createdAt: Date.now(),
      ...payload,
    };

    const written = await client.writeRecord(recordId, record);
    if (!written) {
      throw new Error(`remote-eval: write ${recordId} rejected (check token/permissions)`);
    }

    try {
      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`remote-eval timed out after ${timeout}ms. Is the CodeConvert plugin open in Figma?`));
        }, timeout);

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

      if (result.error) {
        throw new Error(result.error);
      }

      return result.result;
    } finally {
      // Best-effort cleanup
      try { await client.transaction([{ op: 'delete', recordId }]); } catch { /* noop */ }
    }
  }

  return {
    /**
     * Inspect currently selected node(s) in active Figma document.
     */
    async getSelection() {
      const code = `(async () => {
        const sel = figma.currentPage.selection || [];
        return sel.map((n) => ({
          id: n.id,
          name: n.name,
          type: n.type,
          x: n.x,
          y: n.y,
          width: n.width,
          height: n.height,
        }));
      })()`;
      return postEvalRecord({ code });
    },

    /**
     * Run a pipeline stage shortcut (generateHtml, presentationHtml, mediaHtml, getNodeJson).
     */
    async evalStage(kind, { nodeId = null, media = true } = {}) {
      const cleanId = nodeId ? String(nodeId).replace(/-/g, ':') : null;
      return postEvalRecord({
        kind,
        code: kind,
        args: { nodeId: cleanId, media: Boolean(media) },
      }, 120000);
    },

    /**
     * Render a raster PNG screenshot of the specified node (or active selection).
     */
    async screenshot(nodeId = null) {
      const cleanId = nodeId ? String(nodeId).replace(/-/g, ':') : null;
      const code = `(async () => {
        const shotId = ${JSON.stringify(cleanId)};
        const n = shotId ? await figma.getNodeByIdAsync(shotId) : figma.currentPage.selection?.[0];
        if (!n) throw new Error('screenshot: node not found (make sure a node is selected or supply nodeId)');
        const bytes = await n.exportAsync({ format: 'PNG' });
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return { name: n.name, id: n.id, w: n.width, h: n.height, b64: btoa(bin) };
      })()`;
      return postEvalRecord({ code }, 90000);
    },

    /**
     * Run arbitrary JavaScript snippet in the Figma sandbox.
     */
    async eval({ code, args }) {
      if (!code) throw new Error('eval requires a code string');
      return postEvalRecord({ code, args });
    },

    /**
     * Search nodes in active Figma document by query, layer type, with screen/bounds context.
     */
    async search({ query, type = null, limit = 20, allPages = true } = {}) {
      const qStr = JSON.stringify(String(query).toLowerCase());
      const tStr = JSON.stringify(type ? String(type).toUpperCase() : null);
      const lNum = Math.min(Math.max(1, Number(limit) || 20), 100);
      const apBool = allPages !== false;

      const code = `(async () => {
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
      return postEvalRecord({ code }, 60000);
    },

    /**
     * Close the realtime client connection.
     */
    async close() {
      try { client.close(); } catch { /* noop */ }
    },
  };
}

