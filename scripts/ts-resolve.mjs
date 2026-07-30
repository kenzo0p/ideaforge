// Lets `node --experimental-strip-types` resolve the extensionless and
// `@/`-aliased imports that TypeScript allows but Node does not.
import { fileURLToPath, pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { dirname, resolve as resolvePath } from "node:path";

const SRC = resolvePath(fileURLToPath(import.meta.url), "../../src");

export function resolve(specifier, context, next) {
  let spec = specifier;
  if (spec.startsWith("@/")) spec = pathToFileURL(resolvePath(SRC, spec.slice(2))).href;

  if (spec.startsWith(".") || spec.startsWith("file:")) {
    const base = spec.startsWith("file:")
      ? fileURLToPath(spec)
      : resolvePath(dirname(fileURLToPath(context.parentURL)), spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
      if (existsSync(candidate) && !candidate.endsWith("/")) {
        return next(pathToFileURL(candidate).href, context);
      }
    }
  }
  return next(spec, context);
}
