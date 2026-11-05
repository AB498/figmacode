// src/definitions.js — frozen tool and conversion type definitions.
// Adheres to AGENTS.md: definitions are data + frozen. Consumers read
// `describeTools()` — never mutate definitions. Parameter validation
// is fail-fast with clear errors.

/**
 * Supported conversion targets for the unified `figma_convert` tool.
 * Each type maps to an internal stage kind, mime type, and description.
 */
export const CONVERT_TYPES = Object.freeze({
  react: Object.freeze({
    kind: 'generateHtml',
    mimeType: 'text/plain',
    description: 'React JSX component with Tailwind CSS utility classes and clean markup',
  }),
  html: Object.freeze({
    kind: 'presentationHtml',
    mimeType: 'text/html',
    description: 'Self-contained presentation HTML document with preview styles, Babel/React UMD shell, and fonts',
  }),
  media: Object.freeze({
    kind: 'mediaHtml',
    mimeType: 'text/plain',
    description: 'React component with optimized raster media assets and externalized SVG vector defs',
  }),
  screenshot: Object.freeze({
    kind: 'screenshot',
    mimeType: 'image/png',
    description: 'Exact pixel-level PNG screenshot rendered directly from Figma canvas',
  }),
  json: Object.freeze({
    kind: 'getNodeJson',
    mimeType: 'application/json',
    description: 'Raw normalized Figma node scene tree with geometry, fills, typography, and constraints',
  }),
});

/**
 * MCP Tool definitions metadata and JSON schema specifications.
 */
export const TOOL_DEFINITIONS = Object.freeze({
  figma_convert: Object.freeze({
    name: 'figma_convert',
    description: 'Converts a Figma node into code, HTML, media assets, JSON tree, or a PNG screenshot.',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        type: Object.freeze({
          type: 'string',
          enum: Object.freeze(Object.keys(CONVERT_TYPES)),
          default: 'react',
          description: 'Conversion target format: "react" (JSX+Tailwind), "html" (full standalone HTML document), "media" (React with externalized SVG/media), "screenshot" (PNG visual render), or "json" (raw Figma scene dump).',
        }),
        nodeId: Object.freeze({
          type: 'string',
          description: 'Figma node ID to convert (e.g. "123:456" or "123-456"). Defaults to current selection in Figma.',
        }),
        graphics: Object.freeze({
          type: "string",
          enum: Object.freeze(["vector", "raster"]),
          description: "Graphics output format: \"vector\" (SVG curves) or \"raster\" (flattens vector groups into 2x retina PNGs).",
        }),
        media: Object.freeze({
          type: 'boolean',
          default: true,
          description: 'Whether to optimize and extract raster media assets (for react/html targets).',
        }),
        outPath: Object.freeze({
          type: 'string',
          description: 'Optional file path to save the generated code, HTML, JSON, or PNG image directly to disk.',
        }),
      }),
      required: [],
    }),
  }),

  figma_get_selection: Object.freeze({
    name: 'figma_get_selection',
    description: 'Gets details about the currently selected node(s) in the active Figma document (ID, name, type, bounds).',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({}),
      required: [],
    }),
  }),

  figma_eval: Object.freeze({
    name: 'figma_eval',
    description: 'Executes arbitrary JavaScript within the active Figma Plugin sandbox (has access to figma.* API).',
    inputSchema: Object.freeze({
      type: 'object',
      properties: Object.freeze({
        code: Object.freeze({
          type: 'string',
          description: 'JavaScript code snippet to evaluate in Figma plugin context (may return a promise).',
        }),
        args: Object.freeze({
          type: 'object',
          description: 'Optional JSON arguments passed into the evaluated code.',
        }),
      }),
      required: Object.freeze(['code']),
    }),
  }),
});

/**
 * Expose MCP tool descriptors for `tools/list`.
 * Returns a cloned array so consumers cannot mutate the frozen definitions.
 * @returns {Array<object>}
 */
export function describeTools() {
  return Object.values(TOOL_DEFINITIONS).map((tool) => JSON.parse(JSON.stringify(tool)));
}

/**
 * Validate and normalize tool call parameters at the seam.
 * Fails fast with clear error messages.
 *
 * @param {string} toolName
 * @param {Record<string, unknown>} rawArgs
 * @returns {Record<string, unknown>} normalized arguments
 * @throws {Error} on unknown tool name or invalid parameter shape
 */
export function validateToolCall(toolName, rawArgs = {}) {
  const tool = TOOL_DEFINITIONS[toolName];
  if (!tool) {
    const valid = Object.keys(TOOL_DEFINITIONS).join(', ');
    throw new Error(`unknown tool "${toolName}". Supported tools: ${valid}`);
  }

  const args = { ...rawArgs };

  if (toolName === 'figma_convert') {
    const type = args.type ? String(args.type).toLowerCase() : 'react';
    if (!CONVERT_TYPES[type]) {
      const valid = Object.keys(CONVERT_TYPES).join(', ');
      throw new Error(`unsupported conversion type "${args.type}". Supported types: ${valid}`);
    }
    args.type = type;
    args.media = args.media !== undefined ? Boolean(args.media) : true;
    if (args.nodeId) args.nodeId = String(args.nodeId).trim();
    if (args.outPath) args.outPath = String(args.outPath).trim();
    if (args.graphics) {
      const g = String(args.graphics).toLowerCase();
      if (g !== "vector" && g !== "raster") throw new Error(`unsupported graphics format "${args.graphics}". Supported: "vector", "raster"`);
      args.graphics = g;
    }
    return args;
  }

  if (toolName === 'figma_eval') {
    if (!args.code || typeof args.code !== 'string') {
      throw new Error('figma_eval requires a non-empty "code" string argument');
    }
    return args;
  }

  return args;
}

