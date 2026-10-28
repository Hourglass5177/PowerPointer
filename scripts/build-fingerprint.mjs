import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import path from "node:path";

export function dependencyFingerprint(root) {
  const hash = createHash("sha256");
  for (const name of ["package.json", "package-lock.json"]) hash.update(name).update(readFileSync(path.join(root, name)));
  return hash.digest("hex");
}
export function buildFingerprint(root) {
  const hash = createHash("sha256").update(process.versions.node).update(dependencyFingerprint(root));
  const files = [];
  const walk = relative => {
    const full = path.join(root, relative);
    if (!existsSync(full)) return;
    for (const entry of readdirSync(full, { withFileTypes: true })) {
      const next = path.join(relative, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (entry.isFile()) files.push(next);
    }
  };
  for (const folder of ["src", "shared", "server", "public", "docs/manual"]) walk(folder);
  for (const name of ["index.html", "tsconfig.json", "vite.config.ts", "scripts/launch.mjs", "scripts/build.mjs", "scripts/build-fingerprint.mjs", "node_modules/.package-lock.json"]) if (existsSync(path.join(root, name))) files.push(name);
  for (const name of files.sort()) hash.update(name.replaceAll("\\", "/")).update(readFileSync(path.join(root, name)));
  return hash.digest("hex");
}
