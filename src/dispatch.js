// src/dispatch.js — single dispatch slot for MCP tool calls.
// Adheres to AGENTS.md: exactly one dispatch switch over tool name,
// and one single switch over the conversion type discriminator.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { CONVERT_TYPES, validateToolCall } from './definitions.js';

/**
 * Helper to save generated artifact to disk if outPath is provided.
 * @param {string} outPath
 * @param {string|Buffer} content
 * @returns {string} resolved absolute path
 */
function saveToDisk(outPath, content) {
  const abs = resolve(outPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
  return abs;
}

/**
 * Dispatch an MCP tool call to the Figma bridge.
 * Catches errors and formats them into standard MCP { content, isError } structures.
 *
 * @param {object} bridge - Figma bridge client instance
 * @param {string} toolName - Name of the tool to invoke
 * @param {Record<string, unknown>} rawArgs - Unvalidated tool parameters
 * @returns {Promise<{ content: Array<object>, isError: boolean }>}
 */
export async function dispatchToolCall(bridge, toolName, rawArgs = {}) {
  try {
    const args = validateToolCall(toolName, rawArgs);

    switch (toolName) {
      case 'figma_get_selection': {
        const selection = await bridge.getSelection();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(selection ?? [], null, 2),
            },
          ],
          isError: false,
        };
      }

      case 'figma_eval': {
        const res = await bridge.eval({ code: args.code, args: args.args });
        return {
          content: [
            {
              type: 'text',
              text: typeof res === 'string' ? res : JSON.stringify(res ?? null, null, 2),
            },
          ],
          isError: false,
        };
      }

      case 'figma_search': {
        const matches = await bridge.search(args);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(matches ?? [], null, 2),
            },
          ],
          isError: false,
        };
      }

      case 'figma_convert': {
        const { type, nodeId, media, graphics, outPath } = args;
        const def = CONVERT_TYPES[type];
        const cleanNodeId = nodeId ? String(nodeId).replace(/-/g, ':') : null;

        switch (type) {
          case 'react':
          case 'media': {
            const res = await bridge.evalStage(def.kind, {
              nodeId: cleanNodeId,
              media: type === 'media' || media,
              graphics,
            });
            const code = typeof res?.html === 'string' ? res.html : JSON.stringify(res ?? null, null, 2);
            let notice = '';
            if (outPath) {
              const saved = saveToDisk(outPath, code);
              notice = `/* Saved to ${saved} */\n\n`;
            }
            return {
              content: [
                {
                  type: 'text',
                  text: `${notice}${code}`,
                },
              ],
              isError: false,
            };
          }

          case 'html': {
            const html = await bridge.evalStage(def.kind, {
              nodeId: cleanNodeId,
              media,
              graphics,
            });
            const content = String(html ?? '');
            let notice = '';
            if (outPath) {
              const saved = saveToDisk(outPath, content);
              notice = `<!-- Saved to ${saved} -->\n`;
            }
            return {
              content: [
                {
                  type: 'text',
                  text: `${notice}${content}`,
                },
              ],
              isError: false,
            };
          }

          case 'screenshot': {
            const shot = await bridge.screenshot(cleanNodeId);
            const b64 = shot?.b64;
            if (!b64) throw new Error('screenshot: no PNG data returned from Figma');
            if (outPath) {
              saveToDisk(outPath, Buffer.from(b64, 'base64'));
            }
            return {
              content: [
                {
                  type: 'image',
                  data: b64,
                  mimeType: 'image/png',
                },
              ],
              isError: false,
            };
          }

          case 'json': {
            const json = await bridge.evalStage(def.kind, { nodeId: cleanNodeId });
            const text = JSON.stringify(json ?? null, null, 2);
            if (outPath) {
              saveToDisk(outPath, text);
            }
            return {
              content: [
                {
                  type: 'text',
                  text,
                },
              ],
              isError: false,
            };
          }
        }
      }
    }
  } catch (err) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${err?.message || String(err)}`,
        },
      ],
      isError: true,
    };
  }
}

