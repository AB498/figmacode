import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  CONVERT_TYPES,
  TOOL_DEFINITIONS,
  describeTools,
  validateToolCall,
} from '../src/definitions.js';
import { dispatchToolCall } from '../src/dispatch.js';
import { handleJsonRpcMessage } from '../src/server.js';

describe('MCP Definitions', () => {
  it('CONVERT_TYPES is frozen and contains all expected conversion targets', () => {
    assert.equal(Object.isFrozen(CONVERT_TYPES), true);
    const expected = ['react', 'html', 'media', 'screenshot', 'json'];
    assert.deepEqual(Object.keys(CONVERT_TYPES).sort(), expected.sort());
    for (const key of expected) {
      assert.equal(Object.isFrozen(CONVERT_TYPES[key]), true);
      assert.equal(typeof CONVERT_TYPES[key].kind, 'string');
      assert.equal(typeof CONVERT_TYPES[key].mimeType, 'string');
      assert.equal(typeof CONVERT_TYPES[key].description, 'string');
    }
  });

  it('describeTools returns valid MCP tool descriptors', () => {
    const tools = describeTools();
    assert.equal(Array.isArray(tools), true);
    assert.equal(tools.length, 4);
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['figma_convert', 'figma_eval', 'figma_get_selection', 'figma_search']);

    const convertTool = tools.find((t) => t.name === 'figma_convert');
    assert.equal(convertTool.inputSchema.type, 'object');
    assert.deepEqual(
      convertTool.inputSchema.properties.type.enum.sort(),
      ['react', 'html', 'media', 'screenshot', 'json'].sort()
    );
  });

  it('validateToolCall fails fast on unknown tool or invalid type', () => {
    assert.throws(
      () => validateToolCall('unknown_tool', {}),
      /unknown tool "unknown_tool"/
    );

    assert.throws(
      () => validateToolCall('figma_convert', { type: 'invalid_type' }),
      /unsupported conversion type "invalid_type"/
    );

    // Default type is 'react'
    const validated = validateToolCall('figma_convert', {});
    assert.equal(validated.type, 'react');
    assert.equal(validated.media, true);

    // Explicit type is preserved
    const validatedJson = validateToolCall('figma_convert', { type: 'json', nodeId: '10:20' });
    assert.equal(validatedJson.type, 'json');
    assert.equal(validatedJson.nodeId, '10:20');

    assert.throws(
      () => validateToolCall('figma_eval', {}),
      /requires a non-empty "code" string/
    );

    assert.throws(
      () => validateToolCall('figma_search', {}),
      /requires a non-empty "query" string/
    );

    const validSearch = validateToolCall('figma_search', { query: 'enquiry', type: 'text', limit: 10 });
    assert.equal(validSearch.query, 'enquiry');
    assert.equal(validSearch.type, 'TEXT');
    assert.equal(validSearch.limit, 10);
    assert.equal(validSearch.allPages, true);
  });
});

describe('MCP Dispatch', () => {
  function createMockBridge(overrides = {}) {
    const calls = [];
    return {
      calls,
      async eval(args) {
        calls.push({ method: 'eval', args });
        if (overrides.eval) return overrides.eval(args);
        return { result: 'mock_eval_success' };
      },
      async evalStage(kind, args) {
        calls.push({ method: 'evalStage', kind, args });
        if (overrides.evalStage) return overrides.evalStage(kind, args);
        if (kind === 'presentationHtml') return '<html><body>Mock HTML</body></html>';
        if (kind === 'generateHtml' || kind === 'mediaHtml') return { html: 'export default function Mock() { return <div />; }', title: 'Mock' };
        if (kind === 'getNodeJson') return { id: args?.nodeId || '0:1', name: 'Mock Node' };
        throw new Error(`mock unknown stage ${kind}`);
      },
      async screenshot(nodeId) {
        calls.push({ method: 'screenshot', nodeId });
        if (overrides.screenshot) return overrides.screenshot(nodeId);
        return { b64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', w: 100, h: 100 };
      },
      async getSelection() {
        calls.push({ method: 'getSelection' });
        if (overrides.getSelection) return overrides.getSelection();
        return [{ id: '1:2', name: 'Frame 1', type: 'FRAME', width: 200, height: 100 }];
      },
      async search(args) {
        calls.push({ method: 'search', args });
        if (overrides.search) return overrides.search(args);
        return [{ id: '1:2', name: 'Frame 1', type: 'FRAME' }];
      },
      async close() {},
    };
  }

  it('dispatches figma_get_selection', async () => {
    const bridge = createMockBridge();
    const result = await dispatchToolCall(bridge, 'figma_get_selection', {});
    assert.equal(result.isError, false);
    assert.equal(result.content[0].type, 'text');
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed[0].id, '1:2');
    assert.equal(bridge.calls[0].method, 'getSelection');
  });

  it('dispatches figma_convert with type: react', async () => {
    const bridge = createMockBridge();
    const result = await dispatchToolCall(bridge, 'figma_convert', { type: 'react', nodeId: '5:10' });
    assert.equal(result.isError, false);
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /export default function Mock/);
    assert.equal(bridge.calls[0].kind, 'generateHtml');
    assert.equal(bridge.calls[0].args.nodeId, '5:10');
  });

  it('dispatches figma_convert with type: html', async () => {
    const bridge = createMockBridge();
    const result = await dispatchToolCall(bridge, 'figma_convert', { type: 'html', nodeId: '5:10' });
    assert.equal(result.isError, false);
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /<html><body>Mock HTML<\/body><\/html>/);
    assert.equal(bridge.calls[0].kind, 'presentationHtml');
  });

  it('dispatches figma_convert with type: screenshot returning image content', async () => {
    const bridge = createMockBridge();
    const result = await dispatchToolCall(bridge, 'figma_convert', { type: 'screenshot', nodeId: '5:10' });
    assert.equal(result.isError, false);
    assert.equal(result.content[0].type, 'image');
    assert.equal(result.content[0].mimeType, 'image/png');
    assert.equal(typeof result.content[0].data, 'string');
    assert.equal(bridge.calls[0].method, 'screenshot');
  });

  it('dispatches figma_convert with type: json', async () => {
    const bridge = createMockBridge();
    const result = await dispatchToolCall(bridge, 'figma_convert', { type: 'json', nodeId: '5:10' });
    assert.equal(result.isError, false);
    assert.equal(result.content[0].type, 'text');
    const parsed = JSON.parse(result.content[0].text);
    assert.equal(parsed.id, '5:10');
    assert.equal(bridge.calls[0].kind, 'getNodeJson');
  });

  it('dispatches figma_eval', async () => {
    const bridge = createMockBridge();
    const result = await dispatchToolCall(bridge, 'figma_eval', { code: 'figma.currentPage.name' });
    assert.equal(result.isError, false);
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /mock_eval_success/);
  });

  it('dispatches figma_search', async () => {
    const bridge = createMockBridge();
    const result = await dispatchToolCall(bridge, 'figma_search', { query: 'frame' });
    assert.equal(result.isError, false);
    assert.equal(result.content[0].type, 'text');
    assert.match(result.content[0].text, /Frame 1/);
  });

  it('captures errors gracefully and returns isError: true', async () => {
    const bridge = createMockBridge({
      async evalStage() {
        throw new Error('Figma plugin disconnected: Open the CodeConvert plugin in Figma.');
      },
    });
    const result = await dispatchToolCall(bridge, 'figma_convert', { type: 'react' });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Figma plugin disconnected/);
  });
});

describe('MCP JSON-RPC Protocol Server', () => {
  it('handles initialize request', async () => {
    const req = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2024-11-05', clientInfo: { name: 'test-client', version: '1.0' } },
    };
    const res = await handleJsonRpcMessage(req, null);
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 1);
    assert.equal(res.result.protocolVersion, '2024-11-05');
    assert.equal(res.result.serverInfo.name, 'figmacode-mcp');
    assert.equal(typeof res.result.capabilities.tools, 'object');
  });

  it('handles tools/list request', async () => {
    const req = { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} };
    const res = await handleJsonRpcMessage(req, null);
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 2);
    assert.equal(Array.isArray(res.result.tools), true);
    assert.equal(res.result.tools.length, 4);
  });

  it('handles ping request', async () => {
    const req = { jsonrpc: '2.0', id: 3, method: 'ping' };
    const res = await handleJsonRpcMessage(req, null);
    assert.equal(res.jsonrpc, '2.0');
    assert.equal(res.id, 3);
    assert.deepEqual(res.result, {});
  });

  it('handles notifications/initialized without response', async () => {
    const notif = { jsonrpc: '2.0', method: 'notifications/initialized' };
    const res = await handleJsonRpcMessage(notif, null);
    assert.equal(res, null, 'notifications should not produce a response');
  });
});

