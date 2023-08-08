import { Document } from "langchain/document";
import { Document as DBDocument, Prisma } from "@prisma/client";
import { Metadata } from "./types";
import { glob } from "glob";
import { readFileSync } from "fs";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import { PrismaClient } from "@prisma/client";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { PrismaVectorStore } from "langchain/vectorstores/prisma";
import { parse } from "parse-gitignore";
import { join } from "path";

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

  const gitignore = parse(join(m.repoPath, ".gitignore")).patterns;

  const files = await glob("**/*", {
    ignore: [
      "node_modules",
      "node_modules/**",
      ".git",
      ".git/**",
      "pnpm-lock.yaml",
      ".env",
      ".env.*",
      ...gitignore,
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

async function addDocsToVectorstore(splitDocs: Document[]) {
  const db = new PrismaClient();
  const embeddings = new OpenAIEmbeddings({
    modelName: "text-embedding-ada-002",
  });
  const vectorStore = PrismaVectorStore.withModel<DBDocument>(db).create(
    embeddings,
    {
      prisma: Prisma,
      tableName: "Document",
      vectorColumnName: "vector",
      columns: {
        id: PrismaVectorStore.IdColumn,
        content: PrismaVectorStore.ContentColumn,
      },
    }
  );

  console.time(`Creating embeddings`);

  await vectorStore.addModels(
    await db.$transaction(
      splitDocs.map((doc) =>
        db.document.create({
          data: {
            content: doc.pageContent,
            repoPath: doc.metadata.repoPath,
            filePath: doc.metadata.filePath,
            commitHash: doc.metadata.commitHash,
          },
        })
      )
    )
  );

  console.timeEnd(`Creating embeddings`);
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
    let pageContent = readFileSync(exactFilePath).toString();

    pageContent = pageContent.replaceAll("\u0000", "");

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
  }

  return docs;
}
