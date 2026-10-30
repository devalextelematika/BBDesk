import { registerHooks } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import ts from "typescript";

// In-process TSX loader: test the actual source without spawning a bundler.
const root = new URL("../", import.meta.url).href;
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL?.startsWith(root)) {
      const url = new URL(specifier, context.parentURL);
      for (const extension of [".ts", ".tsx"]) {
        const candidate = new URL(url.href + extension);
        if (existsSync(candidate)) return { url: candidate.href, shortCircuit: true };
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.startsWith(root) && !url.includes("/node_modules/")) {
      if (url.endsWith(".css")) return { format: "module", source: "export {};", shortCircuit: true };
      if (/\.tsx?$/.test(url)) {
        const { outputText } = ts.transpileModule(readFileSync(new URL(url), "utf8"), {
          compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
          fileName: new URL(url).pathname,
        });
        return { format: "module", source: outputText, shortCircuit: true };
      }
    }
    return next(url, context);
  },
});
