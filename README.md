# figmacode

CLI to authenticate and run eval code via the CodeConvert Convex backend.

## Install / Run

```sh
npx -y figmacode auth <token>
npx -y figmacode eval "console.log(1+1)"
npx -y figmacode eval "..." --out result.json
```

Or install globally:

```sh
npm i -g figmacode
# Token from figma plugin [https://www.figma.com/community/plugin/1618553111789925879]
figmacode auth <token>
```

## Commands

- `auth <token>` — validate and store a session token in `~/.figmacode/config.json`
- `eval <code>` — run eval code in the Figma plugin. Optional `--out <file>` writes JSON result to a file.
