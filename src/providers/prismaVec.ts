import { Metadata } from "../types";
import { Document } from "langchain/document";
import { Prisma, PrismaClient } from "@prisma/client";
import { Document as DBDocument} from "@prisma/client";
import { VectorStore } from "langchain/dist/vectorstores/base";
import { PrismaVectorStore } from "langchain/vectorstores/prisma";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";


export function createVectorStore(embeddings: OpenAIEmbeddings): VectorStore {
    const db = new PrismaClient();
    return new PrismaVectorStore(embeddings, {
      db,
      prisma: Prisma,
      tableName: "Document",
      vectorColumnName: "vector",
      columns: {
        id: PrismaVectorStore.IdColumn,
        content: PrismaVectorStore.ContentColumn,
      },
    });
  }
  

export async function addDocsToVectorstore(splitDocs: Document[]) {
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
  

export async function deleteOldEmbeddingsForDirtyFiles(
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