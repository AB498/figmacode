# figmacode

CLI and Model Context Protocol (MCP) server to run eval code and convert Figma designs inside the CodeConvert Figma plugin via the realtime backend.

A request is posted as a realtime record, the open plugin executes it in the Figma sandbox and writes the result back, and the CLI/MCP server yields the result.

Requires the CodeConvert plugin to be **open** in Figma while requests execute.

---

## MCP Server (Model Context Protocol)

Connect AI agents (Cursor, Claude Desktop, Antigravity, OpenCode, VS Code) directly to your live Figma canvas.

### Configuration (`.mcp.json` / Claude Desktop / Cursor)

#### Using `npx`

```json
{
  "mcpServers": {
    "figmacode": {
      "command": "npx",
      "args": ["-y", "figmacode", "mcp"],
      "env": {
        "ACCESS_TOKEN": "cct_..."
      }
    }
  }
}
```

#### Local Development

```json
{
  "mcpServers": {
    "figmacode": {
      "command": "node",
      "args": ["/path/to/apps/figmacode/cc.mjs", "mcp"],
      "env": {
        "ACCESS_TOKEN": "cct_..."
      }
    }
  }
}
```

### Available Tools

1. **`figma_convert`**: Unified design-to-code conversion tool with format `type`:
   - `type: "react"` — Clean React JSX component styled with Tailwind CSS utility classes.
   - `type: "html"` — Standalone presentation HTML document with live preview shell and fonts.
   - `type: "media"` — React component with optimized raster media assets and extracted SVG defs.
   - `type: "screenshot"` — Pixel-accurate PNG screenshot (returns native MCP ImageContent).
   - `type: "json"` — Full normalized Figma scene tree JSON dump.
   - Optional parameters:
     - `nodeId` (string) — Target Figma node ID (e.g. `"2276:5825"` or `"2276-5825"`). Defaults to current selection.
     - `graphics` (`"vector"` | `"raster"`) — Graphics rendering strategy (`"vector"` for SVG curves, `"raster"` to flatten vector groups into 2x retina PNGs).
     - `media` (boolean, default: `true`) — Whether to optimize and extract raster media assets.
     - `outPath` (string) — Optional file path to save the generated code, HTML, JSON, or PNG image directly to disk.
2. **`figma_get_selection`**: Inspects currently selected nodes in Figma (ID, name, bounds, type).
3. **`figma_eval`**: Evaluates arbitrary JavaScript within the Figma Plugin sandbox (`figma.*` API).

### Testing with `mcp-caller`

```powershell
npx -y mcp-caller --server-json '{"type":"stdio","command":"npx","args":["-y","figmacode","mcp"]}' --list-tools
```

---

## CLI Usage

### Install / Run

```sh
# one-off with npx (no install)
npx -y figmacode@latest eval "figma.currentPage.name"

# or run locally via node inside apps/figmacode
node cc.mjs eval "figma.currentPage.name"

# or install globally (bins: figmacode, cc, fc, figmacode-mcp)
npm i -g figmacode
figmacode eval "figma.currentPage.selection[0].name"
```

### Token

Get the token from the plugin's account menu (avatar, top-right) — it shows your short `cct_…` access token plus a copy-paste call example. A JWT from `POST /auth/signin` works too.

**Interactive prompt (automatic):**
If you run `figmacode` without an environment variable or flag, it will prompt you interactively in your terminal and save it to `~/.config/figmacode/token` so you never have to re-enter it:

```text
CodeConvert Access Token required (get from plugin avatar menu > Access Token).
Enter Access Token (cct_...): 
Token saved to ~/.config/figmacode/token
```

You can also pass it explicitly via environment variable or CLI flag:

```sh
# powershell
$env:ACCESS_TOKEN="cct_..."; npx -y figmacode@latest react --out Component.jsx

# bash
ACCESS_TOKEN="cct_..." npx -y figmacode@latest eval "figma.currentPage.name"

# or via --token flag
npx -y figmacode@latest react --token "cct_..." --out Component.jsx
```

Rotate the short token at any time: `POST /api/token/rotate` (Bearer auth). The old token stops working immediately.

### Subcommands

- `eval "<js>"` — evaluate JavaScript code in the open Figma plugin context.
- `react` — raw `generateHtml` stage output: React component (JSX).
- `html` — presentation stage output: component wrapped in `buildPresentationShell` (full HTML document).
- `media` — `generateHtml` with optimized raster media and SVG defs.
- `screenshot` (or `snap`) — raster PNG screenshot of the node.
- `json` — full Figma dump (`selection`, `nodes`, `captured_at`, `images`) for a node.
- `mcp` — launch the stdio MCP server directly.

```sh
# evaluate code in Figma
npx -y figmacode@latest eval "figma.currentPage.selection[0].name"

# current selection → React component
npx -y figmacode@latest react --out component.jsx

# specific node → presentation HTML document
npx -y figmacode@latest html --node 218-1782 --out preview.html

# specific node with rasterized vector groups → HTML
npx -y figmacode@latest html --node 218-1782 --graphics raster --out preview.html

# specific node → JSON dump
npx -y figmacode@latest json --node 218-1782 --out dump.json

# screenshot of node
npx -y figmacode@latest screenshot --node 2276-5825 --out snapshot.png

# full react stage result as JSON
npx -y figmacode@latest react --node 2276-5825 --out react-result.json
```

### Flags

- `--token <cct_...>` — access token (alternative to environment variable or interactive prompt).
- `--node <id>` — target a specific Figma node ID (accepts both `123:456` and `123-456` formats; defaults to current selection).
- `--out <path>` — destination file path to save the output (required for `react`, `html`, `media`, `screenshot`, `json`).
- `--graphics vector|raster` — graphics strategy for vector groups (`vector` for SVG curves, `raster` to flatten vector groups into 2x retina PNGs).
- `--vector` / `--raster` — shorthand convenience flags for `--graphics vector` and `--graphics raster`.
- `--media` — optimize and extract raster media assets.
- `--eval "<js>"` | `--code "<js>"` — legacy flags for code execution (both still fully supported).
- `--args '{...}'` — JSON args passed through to the executed code.
- `--timeout ms` — how long to wait for the plugin response (default `120000ms` for stage commands, `60000ms` for eval).
- `--url wss://...` — origin WS url (default `wss://codeconvert.cc`).
- `--delete` — delete the request record right after reading the result.
- `--user <uid>` — target a different user's queue (admins only).

---

## Testing

Run the in-process test suite:

```sh
npm --prefix apps/figmacode test
```
