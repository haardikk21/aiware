import { existsSync } from "fs";
import { join } from "path";
import promptSync from "prompt-sync";
import { doDirtyWork } from "./dirtyWork";
import { embedCodebase } from "./embed";
import { loadOrCreateMetadata } from "./metadata";
import { runQALoop } from "./qa";

const CHECK_STATUS_INTERVAL = 10_000;

const prompt = promptSync();

async function main() {
  const repoPath = getRepoPath();
  const { metadata, isNew } = loadOrCreateMetadata(repoPath);

  if (isNew) {
    console.log(
      "Haven't been trained on this codebase before. Training now..."
    );
    await embedCodebase(metadata, metadata.lastKnownCommitHash);
  }

  setInterval(() => {
    doDirtyWork(metadata);
  }, CHECK_STATUS_INTERVAL);

  await runQALoop(metadata);
}

function getRepoPath() {
  let repoPath = prompt("Enter absolute path to local repo: ");

  if (repoPath === "") {
    repoPath = process.env.DEFAULT_REPO_PATH as string;
  }

  const localGitRepo = join(repoPath, ".git");

  if (!existsSync(localGitRepo)) {
    console.error(`Invalid repo path provided: ${repoPath}`);
    return getRepoPath();
  }

  return repoPath;
}

main()
  .then(() => {
    console.log("Done");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
