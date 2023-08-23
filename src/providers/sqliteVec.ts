import { Metadata } from "../types";
import { Document, DocumentInput } from "langchain/document";
import { VectorStore } from "langchain/vectorstores/base";
import SqliteDb,{ Database } from "better-sqlite3";
import * as sqlite3 from "sqlite3";
import * as sqlite_vss from "sqlite-vss";
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { existsSync, writeFileSync } from "fs";
import { Embeddings } from "langchain/embeddings/base";


const db = initDb();
const sqliteVecData = "sqliteVecData.json";
let vectorStore: SqliteVectorStore;

function initDb() : Database {
  const db = new SqliteDb(":memory:");
  sqlite_vss.loadVss(db);
  sqlite_vss.loadVector(db);
  const stmt: sqlite3.Statement = db.prepare("select vss_version()");
  const version = stmt.run();
  console.log("intialized sqlite db with vss version",version);
  return db;
}

function _initDb() : Database {
  const db: Database = new sqlite3.Database(":memory:");
  sqlite_vss.loadVss(db);
  sqlite_vss.loadVector(db);
  db.serialize(() => {
    const stmt: sqlite3.Statement = db.prepare("select vss_version()");
    stmt.run((val,err)=>{
      console.log("intialized sqlite db with vss version",val);
    });
  });
  return db;
}


class SqliteVectorStore extends VectorStore {

  private db: Database;
  embeddings: Embeddings;
  _vectorstoreType(): string {
   return "sqlite";
  }

  constructor(embeddings: OpenAIEmbeddings, db: Database) {
    super(embeddings,{});
    this.db = db;
    this.embeddings = embeddings;
    this.createTables();
  }

  private createTables() {
    this.db.exec("CREATE TABLE IF NOT EXISTS documents (id INTEGER PRIMARY KEY AUTOINCREMENT, document JSON)");
    this.db.exec("CREATE VIRTUAL TABLE IF NOT EXISTS vss_docs USING vss0()");
  }

  public async loadDocuments(documents: DocumentInput[], embeddings: OpenAIEmbeddings) {
    // Convert DocumentInput to Document objects
    const docs = documents.map((doc) => new Document(doc));

    // Generate embeddings for the new documents
    const vectors = await embeddings.embedDocuments(docs.map(doc=>doc.pageContent));

    // Load the new embeddings into the database
    const vectorInsert = this.db.prepare("INSERT INTO vss_docs (id, vector) VALUES (?, ?)");
    const documentInsert = this.db.prepare("INSERT INTO documents ( document ) VALUES (?)");
    for (let idx = 0; idx < docs.length; idx++) {
      const result = documentInsert.run(docs[idx]);
      const id = result.lastInsertRowid;
      vectorInsert.run(id, vectors[idx]);
    }
  }

  public addVectors(vectors: number[][], documents: Document<Record<string, any>>[], options?: { [x: string]: any; }): Promise<void | string[]> {
    const stmt = this.db.prepare("INSERT INTO vss_docs (vector) VALUES (?)");
    for (const vector of vectors) {
      stmt.run(vector);
    }
    return;
  }

  public addDocuments(documents: Document<Record<string, any>>[], options?: { [x: string]: any; }): Promise<void | string[]> {
    const stmt = this.db.prepare("INSERT INTO vss_docs (id, vector) VALUES (?, ?)");
    for (const document of documents) {
      stmt.run(document.pageContent, document.metadata);
    }
    return;
  }

  public similaritySearchVectorWithScore(query: number[], k: number, filter?: this["FilterType"]): Promise<[Document<Record<string, any>>, number][]> {
    const stmt = this.db.prepare("SELECT id, vss_score(?, vector) as score FROM vss_docs ORDER BY score DESC LIMIT ?");
    const results = stmt.all(query, k);
    return results;
  }

  public save(filePath: string) {
    // Save the vector store data to a file
    const data = this.db.export();
    writeFileSync(filePath, data);
  }

  public async findMatching(metadata: Metadata): Promise<Document[]>{
    const stmt = this.db.prepare("SELECT * FROM documents WHERE document->metadata = ?");
    const result = stmt.all(metadata);
    const docs = result.map(row => new Document(row));

    return docs;
  }

  public async deleteMatching(metadata: Metadata): Promise<number>{
    const documentIdsSelect = this.db.prepare("SELECT id FROM documents WHERE document->metadata = ?");
    const matching = documentIdsSelect.all(metadata);
    const ids = matching.map(item=>item.id);
    const vectorDelete = this.db.prepare("DELETE FROM vss_docs WHERE id = ?");
    const documentDelete = this.db.prepare("DELETE FROM documents WHERE id = ?");
    const vectorResult = vectorDelete.all(ids);
    const documentResult = documentDelete.all(ids);
    const count = vectorResult.changes;

    return count;
  }


}

export function createVectorStore(embeddings: OpenAIEmbeddings): VectorStore {
    if(!vectorStore) {
      if (!restoreVectorStore(embeddings)) {
        vectorStore = new SqliteVectorStore( embeddings, {database:db} );
      }
    }
    return vectorStore;
}

function restoreVectorStore(embeddings: OpenAIEmbeddings) : boolean {
  if(!existsSync(sqliteVecData)) {
    return false;
  } else {
    vectorStore = new SqliteVectorStore(embeddings, { database:db })
    const data = require(`./${sqliteVecData}`);
    const stmt = db.prepare("INSERT INTO vss_docs (doc_id, vector) VALUES (?, ?)");
    for (const { docId, vector } of data) {
      stmt.run(docId, vector);
    }
    return true;
  }
}

export async function addDocsToVectorstore(splitDocs: Document[]): Promise<void> {
    const embeddings = new OpenAIEmbeddings({
      modelName: "text-embedding-ada-002",
    });
    console.time(`Creating embeddings`);
  
     await vectorStore.loadDocuments(
      splitDocs.map(({ pageContent, metadata }) => {
        return new Document({ pageContent , metadata })
      }),
      embeddings);
    
    await vectorStore.save(sqliteVecData);

    console.timeEnd(`Creating embeddings`);
  }
  

export async function deleteOldEmbeddingsForDirtyFiles(
    filePaths: string[],
    m: Metadata
  ): Promise<void> {
    const stmt = db.prepare("DELETE FROM vss_docs WHERE filePath = ? AND commitHash = ?");
    for (const filePath of filePaths) {
      stmt.run(filePath, m.lastKnownCommitHash);
    }
  
    const count = stmt.changes;
    console.log(`Deleted ${count} old embeddings`);
  }