# figmacode

CLI to authenticate and drive the CodeConvert Figma plugin from the terminal — run eval code in the Figma sandbox, export designs to HTML/JSX, and list pages.

## Install / Run

```sh
# one-off (no install)
npx -y figmacode auth <token>
npx -y figmacode generate selection index.html

# or install globally (bin is `cc`)
npm i -g figmacode
cc auth <token>
```

Get the token from the CodeConvert Figma plugin (the account menu shows `npx -y figmacode auth <token>`).
Requires the plugin to be **open** in Figma for `generate`, `pages`, and `eval` to work.

## Commands

- `auth <token>` — validate and store the session token in `~/.cc/config.json`.
- `generate <selection|url|node-id> [out]` — export a design to HTML or JSX.
  - `selection` → currently selected node(s)
  - a figma URL with `?node-id=...` → that node
  - a node id like `355-1581` (or `355:1581`) → that node (on any page)
  - output extension decides format: `.jsx`/`.tsx` → React component, otherwise static HTML
- `pages` — list every page in the file plus each page's top-level frames (current page marked `*`).
- `eval <code> [--out file]` — run arbitrary JS/async in the Figma sandbox; result is printed as JSON (or written to `--out`).

## Examples

```sh
npx -y figmacode auth <token>
npx -y figmacode generate selection index.html
npx -y figmacode generate 355-1581 out.html
npx -y figmacode generate "https://www.figma.com/design/.../?node-id=355-1581" out.html
npx -y figmacode generate selection App.jsx
npx -y figmacode pages
npx -y figmacode eval "figma.currentPage.selection[0].name"
npx -y figmacode eval "figma.root.children.length" --out out.json
```
