import { Metadata } from "../types";
import { Document, DocumentInput } from "langchain/document";
import { VectorStore } from "langchain/vectorstores/base";
import SqliteDb, { Database, Statement } from "better-sqlite3";
import * as sqlite_vss from "sqlite-vss"
import { OpenAIEmbeddings } from "langchain/embeddings/openai";
import { existsSync, writeFileSync, readFileSync, fstat } from "fs";
import { Embeddings } from "langchain/embeddings/base";


const { SQLITEVEC_LOGGING } = process.env;
const sqliteVecData = "sqliteVecData.db";

let db = initDb();
let vectorStore: SqliteVectorStore;

function log(...args) {
  if (!!SQLITEVEC_LOGGING) console.log(`${SQLITEVEC_LOGGING}`,...args);
}

function initDb(data? :Buffer ) : Database {
  const infoQuery = !data?"select vss_version() as vss_version, sqlite_version() as sqlite_version, 'N/A' as vectors;":"select vss_version() as vss_version, sqlite_version() as sqlite_version, COUNT(*) as vectors FROM vss_docs;";
  const db = new SqliteDb(!data?":memory:":data);
  sqlite_vss.loadVector(db);
  sqlite_vss.loadVss(db);
  const stmt: Statement = db.prepare(infoQuery);
  const info = stmt.get();
  log(
    `Intialized sqlite db: 
    sqlite version: ${info.sqlite_version}
    vss version: ${info.vss_version}
    vectors preloaded: ${info.vectors}`);

  return db;
}

class SqliteVectorStore extends VectorStore {

  private db: Database;
  embeddings: Embeddings;
  _vectorstoreType(): string {
   return "sqlite";
  }

  constructor(embeddings: OpenAIEmbeddings, db: Database) {
    if (!embeddings) throw "Embeddings are required to construct a SqliteVectorStore";
    if (!db) throw "A db is required to construct a SqliteVectorStore";
    super(embeddings,{});
    this.db = db;
    this.embeddings = embeddings;
    this.createTables();
  }

  private createTables() {
    const dimensions = 1536; // WARNING: Assumes "text-embedding-ada-002"
    const docResult = this.db.exec("CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, document JSON);");
    const vssResult = this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS vss_docs USING vss0( vector(${dimensions}) );`);
    log('CREATED TABLES');
  }

  public async loadDocuments(documents: DocumentInput[], embeddings: OpenAIEmbeddings) {
    // Convert DocumentInput to Document objects
    const docs = documents.map((doc) => new Document(doc));

    // Generate embeddings for the new documents
    const vectors = await embeddings.embedDocuments(docs.map(doc=>doc.pageContent));

    const insertAll = db.transaction((vectors, docs) => {
      // Find max rowid
      const maxIdSelect = this.db.prepare("SELECT rowid FROM vss_docs ORDER BY rowid DESC LIMIT 1;");
      const maxId = maxIdSelect.get()?.rowid || 0;

      // Load the new embeddings into the database
      for (let idx = 0; idx < docs.length; idx++) {
        const insertIndex = maxId+idx+1;
        const vector = JSON.stringify(vectors[idx]);
        const stmt = `INSERT INTO vss_docs ( rowid, vector ) VALUES ( ${insertIndex}, '${vector}' );`;
        log('LOAD DOCUMENT', stmt.slice(45,70));
        const vectorInsert = this.db.prepare(stmt);
        const result = vectorInsert.run();
        const id = result.lastInsertRowid;
        const documentInsert = this.db.prepare("INSERT INTO docs ( id, document ) VALUES (?, ?);");
        documentInsert.run(id, JSON.stringify(docs[idx]));
      }
    });
    insertAll(vectors, docs);
  }

  public addVectors(vectors: number[][], documents: Document<Record<string, any>>[], options?: { [x: string]: any; }): Promise<void | string[]> {
    /* WARN: required by parent, but doesn't do anything */
    // const stmt = this.db.prepare("INSERT INTO vss_docs (vector) VALUES (?)");
    // for (const vector of vectors) {
    //   stmt.run(vector);
    // }
    return;
  }

  public addDocuments(documents: Document<Record<string, any>>[], options?: { [x: string]: any; }): Promise<void | string[]> {
    /* WARN: required by parent, but doesn't do anything */
    // const stmt = this.db.prepare("INSERT INTO docs (document) VALUES (?)");
    // for (const document of documents) {
    //   stmt.run(document);
    // }
    return;
  }

  public similaritySearchVectorWithScore(query: number[], k: number, filter?: this["FilterType"]): Promise<[Document<Record<string, any>>, number][]> {
    const stmt = `SELECT document, distance FROM vss_docs JOIN docs ON vss_docs.rowid = docs.id WHERE vss_search( vector, vss_search_params('${JSON.stringify(query)}', ${k}) );`;
    const stmtPrepared = this.db.prepare(stmt);
    const results = stmtPrepared.all();
    const output = results.map(result=>[JSON.parse(result.document), result.distance]);
    return output;
  }

  public save(filePath: string) {
    // Save the vector store data to a file
    const data = this.db.serialize();
    writeFileSync(filePath, data);
    log("SAVED");
  }

  public async findMatching(metadata: Metadata): Promise<Document[]>{
    const stmt = this.db.prepare("SELECT * FROM docs WHERE document->metadata = ?;");
    const result = stmt.all(metadata);
    const docs = result.map(row => new Document(row));

    return docs;
  }

  public async deleteMatching(metadata: Metadata): Promise<number>{
    const {repoPath, lastKnownCommitHash} = metadata;
    const documentIdsSelect = this.db.prepare("SELECT id FROM docs WHERE json_extract(document, '$.metadata.repoPath') = ? AND json_extract(document, '$.metadata.commitHash') = ?;");
    const matching = documentIdsSelect.all(repoPath, lastKnownCommitHash);
    const ids = matching.map(item=>item.id);
    const vectorDelete = this.db.prepare("DELETE FROM vss_docs WHERE rowid = ?;");
    const documentDelete = this.db.prepare("DELETE FROM docs WHERE id = ?;");
    const deleteAll = db.transaction((ids) => {
      let result = [];
      for (const id of ids) {
        result.push(vectorDelete.run(id));
        result.push(documentDelete.run(id));
      }
      return result;
    });
    
    const results = deleteAll(ids);
    const count = results.length / 2;

    return count;
  }


}

export function createVectorStore(embeddings: OpenAIEmbeddings): VectorStore {
    if(vectorStore) {
      log(`EXISTS`);
      return vectorStore;
    }

    if (!restoreVectorStore(embeddings)) {
      vectorStore = new SqliteVectorStore( embeddings, db );
      log(`CREATED`);
    } else {
      log(`RESTORED`);
    }

    vectorStore.save(sqliteVecData);

    return vectorStore;
}

function restoreVectorStore(embeddings: OpenAIEmbeddings) : boolean {
  if(!existsSync(sqliteVecData)) {
    return false;
  } else {
    const data = readFileSync(sqliteVecData);
    db = initDb(data);
    vectorStore = new SqliteVectorStore(embeddings, db)
    return true;
  }
}

export async function addDocsToVectorstore(splitDocs: Document[]): Promise<void> {
    const embeddings = new OpenAIEmbeddings({
      modelName: "text-embedding-ada-002",
    });
    console.time(`Creating embeddings`);
  
    if (!vectorStore) {
      vectorStore = createVectorStore(embeddings) as SqliteVectorStore;
    }

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

    if(!vectorStore) {
      console.warn("SqliteVectorStore not created yet!");
      return;
    }

    const count = await vectorStore.deleteMatching(m);

    await vectorStore.save(sqliteVecData);

    console.log(`Deleted ${count} old embeddings`);
  }