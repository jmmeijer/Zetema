import { access, cp, mkdir, rm, symlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const functionsDirectory = path.resolve(scriptDirectory, "..");
const buildDirectory = path.join(functionsDirectory, "lib");
const deployDirectory = path.join(functionsDirectory, "deploy");
const deployBuildDirectory = path.join(deployDirectory, "lib");
const localNodeModulesDirectory = path.join(functionsDirectory, "node_modules");
const deployNodeModulesDirectory = path.join(deployDirectory, "node_modules");
const runtimeDependencies = ["firebase-admin", "firebase-functions"];

await rm(deployBuildDirectory, { recursive: true, force: true });
await rm(deployNodeModulesDirectory, { recursive: true, force: true });
await mkdir(deployDirectory, { recursive: true });
await mkdir(deployNodeModulesDirectory, { recursive: true });
await cp(buildDirectory, deployBuildDirectory, { recursive: true });

// The standalone deploy package is intentionally outside the pnpm workspace so
// Firebase uploads only runtime-safe dependencies instead of workspace:* links.
// Firebase CLI still needs to resolve the Functions SDK locally while it analyzes
// the source. Link the already-installed runtime dependencies for that analysis;
// firebase.json excludes node_modules from the uploaded deployment artifact.
for (const dependency of runtimeDependencies) {
  const source = path.join(localNodeModulesDirectory, dependency);
  const target = path.join(deployNodeModulesDirectory, dependency);

  await access(source);
  await symlink(path.relative(deployNodeModulesDirectory, source), target, "dir");
}

const deployRequire = createRequire(path.join(deployDirectory, "package.json"));
for (const dependency of runtimeDependencies) {
  deployRequire.resolve(dependency);
}

console.log(`Prepared Firebase Functions artifact at ${deployDirectory}`);
console.log("Verified Firebase runtime SDK resolution from the deploy artifact.");
