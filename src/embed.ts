import { Document } from "langchain/document";
import { Metadata } from "./types";
import { glob } from "glob";
import { readFileSync } from "fs";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { addDocsToVectorstore } from "./providers/prismaVec";

export async function embedCodebase(
  m: Metadata,
  currentCommitHash: string,
  filePaths?: string[]
) {
  console.log(
    `Loading ${filePaths ? filePaths.length : "all"} files from ${
      m.repoPath
    }...`
  );

  const ignoredExtensions = [
    "tsbuildinfo",
    "sh",
    "svg",
    "webmanifest",
    "png",
    "ico",
    "xml",
    "woff2",
    "riv",
    "toml",
  ].map((e) => `**/*.${e}`);

  const files = await glob("**/*", {
    ignore: [
      // "node_modules",
      // "node_modules/**",
      ".git",
      ".git/**",
      "pnpm-lock.yaml",
      ".env",
      ".env.*",
      "dist",
      "dist/**",
      ...ignoredExtensions,
    ],
    cwd: m.repoPath,
    nodir: true,
  });

  let filesToEmbed = files;

  if (filePaths) {
    filesToEmbed = files.filter((f) => filePaths?.includes(f));
  }

  console.log(`Found ${filesToEmbed.length} files to embed`);

  let exactFilePathsToEmbed = filesToEmbed.map((f) => `${m.repoPath}/${f}`);

  const docs = getDocumentsForFilepaths(
    m,
    exactFilePathsToEmbed,
    currentCommitHash
  );
  const splitDocs = await splitDocuments(docs);

  console.log(`Split ${docs.length} docs into ${splitDocs.length} docs`);

  await addDocsToVectorstore(splitDocs);
}


async function splitDocuments(docs: Document[]) {
  const splitDocs: Document[] = [];

  for (const doc of docs) {
    const fileExtension = doc.metadata.filePath.split(".").pop() ?? "";
    const splitter = getFileSplitterForExtension(fileExtension);

    const splitDoc = await splitter.splitDocuments([doc]);

    splitDocs.push(...splitDoc);
  }

  return splitDocs;
}

function getFileSplitterForExtension(fileExtension: string) {
  const options = {
    chunkSize: 5000,
    chunkOverlap: 2000,
  };

  switch (fileExtension) {
    case "js":
      return RecursiveCharacterTextSplitter.fromLanguage("js", options);
    case "ts":
      return RecursiveCharacterTextSplitter.fromLanguage("js", options);
    case "jsx":
      return RecursiveCharacterTextSplitter.fromLanguage("js", options);
    case "tsx":
      return RecursiveCharacterTextSplitter.fromLanguage("js", options);
    case "md":
      return RecursiveCharacterTextSplitter.fromLanguage("markdown", options);
    default:
      return new RecursiveCharacterTextSplitter(options);
  }
}

function getDocumentsForFilepaths(
  m: Metadata,
  exactFilePaths: string[],
  currentCommitHash: string
) {
  const docs: Document[] = [];
  for (const exactFilePath of exactFilePaths) {
    try {
      const pageContent = readFileSync(exactFilePath).toString();

      if (pageContent.length <= 0 || typeof pageContent !== "string") continue;

      const doc = new Document({
        pageContent,
        metadata: {
          filePath: exactFilePath,
          commitHash: currentCommitHash,
          repoPath: m.repoPath,
        },
      });

      docs.push(doc);
    } catch {
      console.log("SKIPPING: ",exactFilePath); //MBH
    }
  }

  return docs;
}
