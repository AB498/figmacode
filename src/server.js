// src/server.js — JSON-RPC 2.0 Stdio MCP Server implementation.
// Adheres to standard MCP protocol without external dependencies.

import readline from 'node:readline';
import { describeTools } from './definitions.js';
import { dispatchToolCall } from './dispatch.js';

export const PROTOCOL_VERSION = '2024-11-05';
export const SERVER_INFO = Object.freeze({
  name: 'figmacode-mcp',
  version: '1.0.12',
});

/**
 * Handle a single JSON-RPC 2.0 message.
 * Returns response object, or null for notifications.
 *
 * @param {object} msg - Parsed JSON-RPC message
 * @param {object} bridge - Figma bridge client
 * @returns {Promise<object|null>}
 */
export async function handleJsonRpcMessage(msg, bridge) {
  if (!msg || typeof msg !== 'object') {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request' },
    };
  }

  const { id, method, params } = msg;

  // Notifications (requests without id) do not get responses
  const isNotification = id === undefined || id === null;

  try {
    switch (method) {
      case 'initialize': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {
              tools: {},
            },
            serverInfo: SERVER_INFO,
          },
        };
      }

      case 'notifications/initialized': {
        return null;
      }

      case 'ping': {
        return {
          jsonrpc: '2.0',
          id,
          result: {},
        };
      }

      case 'tools/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: {
            tools: describeTools(),
          },
        };
      }

      case 'prompts/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: { prompts: [] },
        };
      }

      case 'resources/list': {
        return {
          jsonrpc: '2.0',
          id,
          result: { resources: [] },
        };
      }

      case 'tools/call': {
        if (!params || typeof params.name !== 'string') {
          return {
            jsonrpc: '2.0',
            id,
            error: { code: -32602, message: 'Invalid params: tool "name" required' },
          };
        }
        const toolResult = await dispatchToolCall(bridge, params.name, params.arguments || {});
        return {
          jsonrpc: '2.0',
          id,
          result: toolResult,
        };
      }

      default: {
        if (isNotification) return null;
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Method not found: "${method}"` },
        };
      }
    }
  } catch (err) {
    if (isNotification) return null;
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32603,
        message: `Internal error: ${err?.message || String(err)}`,
      },
    };
  }
}

/**
 * Start the MCP Server reading from input stream and writing to output stream.
 *
 * @param {NodeJS.ReadableStream} stdin
 * @param {NodeJS.WritableStream} stdout
 * @param {object} bridge
 * @returns {{ close: () => void }}
 */
export function createMcpServer(stdin, stdout, bridge) {
  const rl = readline.createInterface({
    input: stdin,
    output: stdout,
    terminal: false,
  });

  const send = (msg) => {
    if (msg) {
      stdout.write(`${JSON.stringify(msg)}\n`);
    }
  };

  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      send({
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON' },
      });
      return;
    }

    try {
      const response = await handleJsonRpcMessage(parsed, bridge);
      if (response) send(response);
    } catch (err) {
      console.error('[mcp-server] unhandled message error:', err);
    }
  });

  return {
    close() {
      rl.close();
      try { bridge?.close?.(); } catch { /* noop */ }
    },
  };
}

