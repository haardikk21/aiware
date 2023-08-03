import { execSync } from "child_process";
import { Metadata } from "./types";
import { PrismaClient } from "@prisma/client";
import { embedCodebase } from "./embed";
import { updateMetadataWithLatestCommitHash } from "./metadata";

export async function doDirtyWork(m: Metadata) {
  const { latestCommitHash, isDirty } = isRepoDirty(m);
  if (!isDirty) {
    return;
  }

  console.log(`Repo ${m.repoPath} is dirty. Finding changes...`);

  const filePaths = findDirtyFiles(m);
  const exactFilePaths = filePaths.map((f) => `${m.repoPath}/${f}`);

  console.log(`Found ${filePaths.length} dirty files`);

  await deleteOldEmbeddingsForDirtyFiles(exactFilePaths, m);
  await embedCodebase(m, latestCommitHash, filePaths);

  updateMetadataWithLatestCommitHash(m, latestCommitHash);
}

async function deleteOldEmbeddingsForDirtyFiles(
  filePaths: string[],
  m: Metadata
) {
  const prisma = new PrismaClient();

  const { count } = await prisma.document.deleteMany({
    where: {
      filePath: {
        in: filePaths,
      },
      commitHash: m.lastKnownCommitHash,
    },
  });

  console.log(`Deleted ${count} old embeddings`);
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
