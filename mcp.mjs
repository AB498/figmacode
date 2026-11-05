#!/usr/bin/env node
// mcp.mjs — Executable Stdio MCP server entrypoint for figmacode.
// Communicates via JSON-RPC 2.0 over stdin/stdout.
// IMPORTANT: stdout is reserved exclusively for JSON-RPC. All logging goes to stderr.

import { createMcpServer } from './src/server.js';
import { createFigmaBridge } from './src/bridge.js';

let bridgeInstance = null;
let bridgeConnecting = null;

/**
 * Lazy bridge provider: connects on demand so the MCP server
 * starts up in <10ms and satisfies initialize/tools/list immediately.
 */
const lazyBridge = {
  async getBridge() {
    if (bridgeInstance) return bridgeInstance;
    if (bridgeConnecting) return bridgeConnecting;

    bridgeConnecting = (async () => {
      try {
        bridgeInstance = await createFigmaBridge();
        return bridgeInstance;
      } catch (err) {
        bridgeConnecting = null;
        throw err;
      }
    })();

    return bridgeConnecting;
  },

  async getSelection() {
    const b = await this.getBridge();
    return b.getSelection();
  },

  async evalStage(kind, args) {
    const b = await this.getBridge();
    return b.evalStage(kind, args);
  },

  async screenshot(nodeId) {
    const b = await this.getBridge();
    return b.screenshot(nodeId);
  },

  async eval(args) {
    const b = await this.getBridge();
    return b.eval(args);
  },

  async close() {
    if (bridgeInstance) {
      await bridgeInstance.close();
      bridgeInstance = null;
    }
  },
};

const server = createMcpServer(process.stdin, process.stdout, lazyBridge);

const shutdown = async () => {
  server.close();
  await lazyBridge.close();
  process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.error('[figmacode-mcp] server listening on stdio');

