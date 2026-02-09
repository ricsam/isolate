#!/usr/bin/env bun

import { $ } from "bun";

const TARGET_DIR = "../build-it-now/isolate";

const copy = process.argv.includes("--copy");

// Validate target is a git repo
const targetGitDir = Bun.file(`${TARGET_DIR}/.git`);
if (!(await targetGitDir.exists())) {
  console.error(`Error: ${TARGET_DIR} is not a git repository`);
  process.exit(1);
}

// Get last commit in target repo
const targetCommit = (
  await $`git -C ${TARGET_DIR} rev-parse HEAD`.text()
).trim();
console.log(`Last commit in ${TARGET_DIR}: ${targetCommit}`);

// Verify that commit exists in current repo
try {
  await $`git cat-file -e ${targetCommit}`.quiet();
} catch {
  console.error(`Error: commit ${targetCommit} not found in current repo`);
  process.exit(1);
}

const currentCommit = (await $`git rev-parse HEAD`.text()).trim();
console.log(`Last commit in current repo: ${currentCommit}`);
console.log("");

// Files changed between the two commits
let committedFiles: string[] = [];
if (targetCommit !== currentCommit) {
  const output = (
    await $`git diff --name-only ${targetCommit} ${currentCommit}`.text()
  ).trim();
  if (output) committedFiles = output.split("\n");
}

// Uncommitted changes in current repo (staged + unstaged + untracked)
const uncommittedFiles = new Set<string>();

const unstaged = (await $`git diff --name-only HEAD`.text()).trim();
if (unstaged) unstaged.split("\n").forEach((f) => uncommittedFiles.add(f));

const staged = (await $`git diff --name-only --cached HEAD`.text()).trim();
if (staged) staged.split("\n").forEach((f) => uncommittedFiles.add(f));

const untracked = (
  await $`git ls-files --others --exclude-standard`.text()
).trim();
if (untracked) untracked.split("\n").forEach((f) => uncommittedFiles.add(f));

// Unstaged changes in the target repo
const targetUnstaged = new Set<string>();
const targetUnstagedOutput = (
  await $`git -C ${TARGET_DIR} diff --name-only`.text()
).trim();
if (targetUnstagedOutput)
  targetUnstagedOutput.split("\n").forEach((f) => targetUnstaged.add(f));

const targetStagedOutput = (
  await $`git -C ${TARGET_DIR} diff --name-only --cached`.text()
).trim();
if (targetStagedOutput)
  targetStagedOutput.split("\n").forEach((f) => targetUnstaged.add(f));

const targetUntrackedOutput = (
  await $`git -C ${TARGET_DIR} ls-files --others --exclude-standard`.text()
).trim();
if (targetUntrackedOutput)
  targetUntrackedOutput.split("\n").forEach((f) => targetUnstaged.add(f));

// Combine and deduplicate
const candidateFiles = [
  ...new Set([...committedFiles, ...uncommittedFiles]),
].sort();

if (candidateFiles.length === 0) {
  console.log("No changes found.");
  process.exit(0);
}

// Filter to only files that actually differ between source and target
const diffFiles: string[] = [];
const deletedFiles: string[] = [];
for (const f of candidateFiles) {
  const sourceFile = Bun.file(f);
  const targetFile = Bun.file(`${TARGET_DIR}/${f}`);
  const sourceExists = await sourceFile.exists();
  const targetExists = await targetFile.exists();

  if (!sourceExists && !targetExists) continue;
  if (!sourceExists) {
    deletedFiles.push(f);
    continue;
  }
  if (!targetExists) {
    diffFiles.push(f);
    continue;
  }
  // Both exist — compare contents
  const [sourceBytes, targetBytes] = await Promise.all([
    sourceFile.arrayBuffer(),
    targetFile.arrayBuffer(),
  ]);
  if (
    sourceBytes.byteLength !== targetBytes.byteLength ||
    !Buffer.from(sourceBytes).equals(Buffer.from(targetBytes))
  ) {
    diffFiles.push(f);
  }
}

const allFiles = [...diffFiles, ...deletedFiles];

if (allFiles.length === 0) {
  console.log("No differing files found.");
  process.exit(0);
}

// Check for conflicts with target's unstaged changes
const conflicts = allFiles.filter((f) => targetUnstaged.has(f));

console.log(`Differing files (${allFiles.length}):`);
for (const f of allFiles) {
  const deleted = deletedFiles.includes(f);
  const marker = targetUnstaged.has(f) ? " ⚠ (modified in target)" : "";
  console.log(`  ${f}${deleted ? " (deleted)" : ""}${marker}`);
}

if (conflicts.length > 0) {
  console.log("");
  console.log(
    `Warning: ${conflicts.length} file(s) have unstaged changes in ${TARGET_DIR}:`
  );
  for (const f of conflicts) {
    console.log(`  ${f}`);
  }
}

if (copy) {
  if (conflicts.length > 0) {
    console.log("");
    console.log(
      "Proceeding with copy — files with unstaged target changes will be overwritten."
    );
  }
  console.log("");
  console.log(`Copying files to ${TARGET_DIR}...`);
  for (const f of diffFiles) {
    const targetPath = `${TARGET_DIR}/${f}`;
    await $`mkdir -p ${TARGET_DIR}/${f.substring(0, f.lastIndexOf("/"))}`;
    await Bun.write(targetPath, Bun.file(f));
    console.log(`  copied: ${f}`);
  }
  for (const f of deletedFiles) {
    console.log(`  skipped (deleted in source): ${f}`);
  }
  console.log("Done.");
}
