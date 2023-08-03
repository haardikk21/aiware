import { execSync } from "child_process";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { Metadata } from "./types";

export function updateMetadataWithLatestCommitHash(
  m: Metadata,
  currentCommitHash: string
) {
  m.lastKnownCommitHash = currentCommitHash;
  const repoPathWithoutSlashes = m.repoPath.replace(/\//g, "_");
  const metadataPath = join("./metadatas", repoPathWithoutSlashes) + ".json";
  writeFileSync(metadataPath, JSON.stringify(m, null, 2));
}

export function loadOrCreateMetadata(repoPath: string): {
  metadata: Metadata;
  isNew: boolean;
} {
  const repoPathWithoutSlashes = repoPath.replace(/\//g, "_");
  const metadataPath = join("./metadatas", repoPathWithoutSlashes) + ".json";
  if (existsSync(metadataPath)) {
    console.log(`Found existing metadata for ${repoPath}`);

    const metadata = JSON.parse(
      readFileSync(metadataPath, "utf-8")
    ) as Metadata;

    return {
      metadata,
      isNew: false,
    };
  }

  console.log(`No existing metadata found for ${repoPath}. Creating new...`);

  const lastKnownCommitHash = execSync("git rev-parse HEAD", {
    cwd: repoPath,
  })
    .toString()
    .trim();

  const metadata: Metadata = {
    repoPath,
    lastKnownCommitHash,
  };

  writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));

  return { metadata, isNew: true };
}
