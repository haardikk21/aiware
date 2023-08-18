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
  
    const chunks = split(splitDocs);
    for(let chunk of chunks) {
      await vectorStore.addModels(
        await db.$transaction(
          prepareDocs(chunk, db)
        )
      );  
    }
  
    console.timeEnd(`Creating embeddings`);
  }

function split( stuff: Document<Record<string, any>>[] ): Document<Record<string, any>>[][]{
  const size = 1000;
  let chunks = [];
  for(let i=0; i<stuff.length; i+=size) {
    chunks.push(stuff.slice(i,i+size));
  }
  return chunks;
}

function prepareDocs(splitDocs: Document<Record<string, any>>[], db: PrismaClient): Prisma.PrismaPromise<any>[] {
  return splitDocs.map((doc)=>prepareDoc(doc,db));
}

function prepareDoc(doc: Document<Record<string, any>>, db: PrismaClient) {
  const {pageContent} = doc;
  const {repoPath, filePath, commitHash} = doc.metadata;
  const allValidUtf8 = [pageContent, repoPath, filePath, commitHash].reduce((result,value)=>{return result && isValidUtf8(value);},true);
  const hasNullBytes = [pageContent, repoPath, filePath, commitHash].reduce((result,value)=>{return result && hasNullByte(value);},true);
  
  if ( !allValidUtf8 ) {
    console.log(`INVALID UTF8: skipping ${doc.metadata.filePath}`);
  } else if ( hasNullBytes ) {
    console.log(`NULL BYTES: skipping ${doc.metadata.filePath}`);
  } else {
    console.log(`PROCESSING: ${doc.metadata.filePath}`);
    return db.document.create({
      data: {
        content: doc.pageContent,
        repoPath: doc.metadata.repoPath,
        filePath: doc.metadata.filePath,
        commitHash: doc.metadata.commitHash,
      },
    });
  }
}

function hasNullByte(testString: string): boolean {
  const buffer = Buffer.from(testString);
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] === 0) {
      return true;
    }
  }
  return false;
}

function isValidUtf8(testString: string): boolean {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  try {
    const encodedData = encoder.encode(testString);
    const decodedData = decoder.decode(encodedData);
    return testString == decodedData;
  } catch (error) {
    return false;
  }

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