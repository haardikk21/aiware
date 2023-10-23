import { execSync } from "child_process";
import { Metadata } from "./types";
import { deleteOldEmbeddingsForDirtyFiles } from "./providers/sqliteVec";
import { embedCodebase } from "./embed";
import { updateMetadataWithLatestCommitHash } from "./metadata";

export async function doDirtyWork(m: Metadata, force: boolean = false) {
  const { latestCommitHash, isDirty } = isRepoDirty(m);
  if (!isDirty && !force) {
    return;
  }

  console.log(`Repo ${m.repoPath} is dirty. Finding changes...`);

  const filePaths = !force?findDirtyFiles(m):findLocallyModifiedFiles(m);
  const exactFilePaths = filePaths.map((f) => `${m.repoPath}/${f}`);

  console.log(`Found ${filePaths.length} dirty files`);

  await deleteOldEmbeddingsForDirtyFiles(exactFilePaths, m);
  await embedCodebase(m, latestCommitHash, filePaths);

  updateMetadataWithLatestCommitHash(m, latestCommitHash);
}

export function findLocallyModifiedFiles(m: Metadata) {
  // Find what files have changed since last commit, including untracked files
  // Return a list of files

  // git status --porcelain

  const filePaths = execSync(
    `git status --porcelain`,
    {
      cwd: m.repoPath,
    }
  )
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(" ")[1]);

  return filePaths;
}

export function findDirtyFiles(m: Metadata) {
  // Find what files have changed since lastKnownCommitHash
  // Return a list of files

  // git diff --name-only <lastKnownCommitHash> HEAD

  const filePaths = execSync(
    `git diff --name-only ${m.lastKnownCommitHash} HEAD`,
    {
      cwd: m.repoPath,
    }
  )
    .toString()
    .split("\n")
    .map((filePath) => filePath.trim())
    .filter((filePath) => filePath.length > 0);

  return filePaths;
}

function isRepoDirty(m: Metadata): {
  isDirty: boolean;
  latestCommitHash: string;
} {
  const currentCommitHash = execSync("git rev-parse HEAD", {
    cwd: m.repoPath,
  })
    .toString()
    .trim();

  if (currentCommitHash !== m.lastKnownCommitHash) {
    return {
      isDirty: true,
      latestCommitHash: currentCommitHash,
    };
  }

  return {
    isDirty: false,
    latestCommitHash: currentCommitHash,
  };
}
