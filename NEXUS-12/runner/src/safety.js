import path from "node:path";
import fs from "node:fs/promises";

const ALLOWED_COMMANDS = new Set([
  "npm test",
  "npm run build",
  "npm run lint",
  "npm install",
  "npm ci",
  "node --version",
  "npm --version",
  "git status --short"
]);

export function resolveWorkspacePath(workspace, requested) {
  const root = path.resolve(workspace);
  const target = path.resolve(root, requested);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error("Path is outside the assigned workspace.");
  }
  return target;
}

export async function readWorkspaceFile(workspace, requested) {
  const target = resolveWorkspacePath(workspace, requested);
  const stat = await fs.stat(target);
  if (!stat.isFile() || stat.size > 200_000) throw new Error("File is not a regular file or exceeds 200 KB.");
  return fs.readFile(target, "utf8");
}

export async function writeWorkspaceFile(workspace, requested, content) {
  if (typeof content !== "string" || content.length > 200_000) throw new Error("File content must be text under 200 KB.");
  const target = resolveWorkspacePath(workspace, requested);
  await fs.mkdir(path.dirname(target), {recursive:true});
  await fs.writeFile(target, content, "utf8");
  return target;
}

export function validateCommand(command) {
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error("Command is not allowlisted. Allowed: " + [...ALLOWED_COMMANDS].join(", "));
  }
  return command;
}
