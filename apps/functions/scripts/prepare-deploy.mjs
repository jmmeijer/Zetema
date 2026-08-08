import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const functionsDirectory = path.resolve(scriptDirectory, "..");
const buildDirectory = path.join(functionsDirectory, "lib");
const deployDirectory = path.join(functionsDirectory, "deploy");
const deployBuildDirectory = path.join(deployDirectory, "lib");

await rm(deployBuildDirectory, { recursive: true, force: true });
await mkdir(deployDirectory, { recursive: true });
await cp(buildDirectory, deployBuildDirectory, { recursive: true });

console.log(`Prepared Firebase Functions artifact at ${deployDirectory}`);
