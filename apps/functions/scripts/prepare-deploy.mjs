import { execFile } from "node:child_process";
import { access, cp, mkdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

const execFileAsync = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const functionsDirectory = path.resolve(scriptDirectory, "..");
const buildDirectory = path.join(functionsDirectory, "lib");
const deployDirectory = path.join(functionsDirectory, "deploy");
const deployBuildDirectory = path.join(deployDirectory, "lib");
const deployNodeModulesDirectory = path.join(deployDirectory, "node_modules");
const firebaseFunctionsBinary = path.join(
  deployNodeModulesDirectory,
  ".bin",
  process.platform === "win32" ? "firebase-functions.cmd" : "firebase-functions",
);

await rm(deployBuildDirectory, { recursive: true, force: true });
await rm(deployNodeModulesDirectory, { recursive: true, force: true });
await mkdir(deployDirectory, { recursive: true });
await cp(buildDirectory, deployBuildDirectory, { recursive: true });

// The Firebase source directory is a standalone deployment package. Install its
// pinned runtime dependencies normally so firebase-tools can discover the
// firebase-functions SDK through node_modules/.bin while analyzing the source.
// node_modules remains excluded from the uploaded artifact; Cloud Build installs
// the same declared dependencies again for the deployed runtime.
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
await execFileAsync(
  npmCommand,
  [
    "install",
    "--omit=dev",
    "--ignore-scripts",
    "--package-lock=false",
    "--fund=false",
    "--audit=false",
  ],
  {
    cwd: deployDirectory,
    maxBuffer: 10 * 1024 * 1024,
  },
);

await access(firebaseFunctionsBinary);

console.log(`Prepared Firebase Functions artifact at ${deployDirectory}`);
console.log(`Verified Firebase Functions discovery binary at ${firebaseFunctionsBinary}.`);
