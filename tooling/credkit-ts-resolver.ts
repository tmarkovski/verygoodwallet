import { existsSync } from "node:fs";
import path from "node:path";

// credkit (github:tmarkovski/credkit) ships TypeScript source whose relative
// imports carry .js specifiers (the NodeNext idiom): `import ... from
// "./core.js"` next to a core.ts that has no built core.js. Bundlers resolve
// the specifier literally and find nothing. Remap `./x.js` -> `./x.ts` when
// the .js target does not exist on disk (MIGRATION.md Appendix C). Shared by
// the app vite configs and by every vitest config whose tests reach credkit —
// vitest additionally needs `server.deps.inline` for @credkit/* so the TS
// source goes through this pipeline instead of a raw Node import.
export function credkitTsResolver() {
  return {
    name: "vgw:credkit-ts-from-js",
    enforce: "pre" as const,
    resolveId(source: string, importer: string | undefined) {
      if (!importer || !source.startsWith(".") || !source.endsWith(".js")) return null;
      const abs = path.resolve(path.dirname(importer), source);
      if (existsSync(abs)) return null;
      const ts = `${abs.slice(0, -3)}.ts`;
      return existsSync(ts) ? ts : null;
    },
  };
}
