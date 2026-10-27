import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import type { Document, Conversation, Turn, LearningNote, KnowledgeRevision } from "../shared/types.ts";
import { tokenize } from "./search.ts";
export class Store {
  db: DatabaseSync;
  private transactionDepth = 0;
  constructor(public dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new DatabaseSync(path.join(dir, "library.sqlite"));
    this.db.exec(
      "PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS records (kind TEXT, id TEXT, body TEXT NOT NULL, PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS pages(doc TEXT,page INTEGER,text TEXT, PRIMARY KEY(doc,page));",
    );
    const version = (
      this.db.prepare("PRAGMA user_version").get() as { user_version: number }
    ).user_version;
    if (version < 2) {
      const backup = path.join(dir, "before-power-pointer-v2.sqlite");
      if (!existsSync(backup) && this.all("document").length)
        this.db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
      this.db.exec(
        "CREATE VIRTUAL TABLE IF NOT EXISTS page_fts USING fts5(doc UNINDEXED,page UNINDEXED,tokens,tokenize='unicode61');",
      );
      this.transaction(() => {
        this.db.exec("DELETE FROM page_fts");
        const insert = this.db.prepare(
          "INSERT INTO page_fts(doc,page,tokens) VALUES(?,?,?)",
        );
        for (const p of this.db
          .prepare("SELECT doc,page,text FROM pages")
          .all() as { doc: string; page: number; text: string }[])
          insert.run(p.doc, p.page, tokenize(p.text).join(" "));
        this.db.exec("PRAGMA user_version=2");
      });
    }
    if (version < 3) {
      const backup = path.join(dir, "before-learning-v3.sqlite");
      if (!existsSync(backup) && (this.db.prepare("SELECT COUNT(*) AS n FROM records").get() as { n: number }).n)
        this.db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
      this.transaction(() => {
        for (const note of this.all<LearningNote>("note")) {
          const turn = this.turn(note.id);
          this.put("note", { ...note, version: note.version || 1, updatedAt: note.updatedAt || note.createdAt, documentId: note.documentId || turn?.snapshot.documentId || note.sources[0]?.documentId, originTurnId: note.originTurnId || turn?.id, originKind: note.originKind || (turn ? "turn" : undefined), anchor: note.anchor || turn?.snapshot.selections?.[0] });
        }
        for (const r of this.all<KnowledgeRevision>("knowledge")) this.put("knowledge", {
          ...r, resultVersion: r.resultVersion || 1,
          chapters: r.chapters.map(c => {
            const pages = r.pages.filter(p => p.documentId === c.documentId);
            const completed = pages.filter(p => p.state === "completed").length;
            const failed = pages.filter(p => p.state === "failed").length;
            return { ...c, state: c.state || (failed ? "partial" : "completed"), completed: c.completed ?? completed, summaryCompleted: c.summaryCompleted ?? completed, failed: c.failed ?? failed, total: c.total ?? this.document(c.documentId)?.pages ?? pages.length };
          }),
        });
        this.db.exec("PRAGMA user_version=3");
      });
    }
    if (version < 4) {
      const backup = path.join(dir, "before-ai-v4.sqlite");
      if (!existsSync(backup) && (this.db.prepare("SELECT COUNT(*) AS n FROM records").get() as { n: number }).n)
        this.db.exec(`VACUUM INTO '${backup.replaceAll("'", "''")}'`);
      this.transaction(() => {
        for (const c of this.all<Conversation>("conversation")) this.put("conversation", { ...c, connectionId: c.connectionId || "codex" });
        for (const kind of ["turn", "readingTurn"]) for (const t of this.all<Turn>(kind)) this.put(kind, { ...t, connectionId: t.connectionId || "codex", snapshot: { ...t.snapshot, connectionId: t.snapshot.connectionId || "codex" } });
        for (const kind of ["reading", "knowledge"]) for (const r of this.all<{ id: string; settings?: Record<string, unknown> }>(kind)) this.put(kind, { ...r, settings: { ...r.settings, connectionId: r.settings?.connectionId || "codex" } });
        this.db.exec("PRAGMA user_version=4");
      });
    }
  }
  all<T>(kind: string): T[] {
    return (
      this.db
        .prepare("SELECT body FROM records WHERE kind=? ORDER BY rowid")
        .all(kind) as { body: string }[]
    ).map((r) => JSON.parse(r.body));
  }
  get<T>(kind: string, id: string): T | undefined {
    const r = this.db
      .prepare("SELECT body FROM records WHERE kind=? AND id=?")
      .get(kind, id) as { body: string } | undefined;
    return r ? JSON.parse(r.body) : undefined;
  }
  put<T extends { id: string }>(kind: string, obj: T) {
    this.db
      .prepare(
        "INSERT INTO records(kind,id,body) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET body=excluded.body",
      )
      .run(kind, obj.id, JSON.stringify(obj));
    return obj;
  }
  remove(kind: string, id: string) {
    this.db.prepare("DELETE FROM records WHERE kind=? AND id=?").run(kind, id);
  }
  transaction<T>(fn: () => T): T {
    const depth = this.transactionDepth;
    this.db.exec(depth ? `SAVEPOINT nested_${depth}` : "BEGIN IMMEDIATE");
    this.transactionDepth++;
    try {
      const result = fn();
      this.db.exec(depth ? `RELEASE SAVEPOINT nested_${depth}` : "COMMIT");
      return result;
    } catch (e) {
      this.db.exec(depth ? `ROLLBACK TO SAVEPOINT nested_${depth}; RELEASE SAVEPOINT nested_${depth}` : "ROLLBACK");
      throw e;
    } finally {
      this.transactionDepth--;
    }
  }
  searchDocuments(documentIds: string[], query: string, limit = 8) {
    const tokens = [...new Set(tokenize(query))].slice(0, 60);
    if (!documentIds.length || !tokens.length) return [];
    // Every MATCH token is quoted; user prose never becomes FTS query syntax.
    const match = tokens
      .map((t) => '"' + t.replaceAll('"', '""') + '"')
      .join(" OR ");
    return this.db
      .prepare(
        `SELECT p.doc AS documentId,p.page,p.text,bm25(page_fts) AS rank
      FROM page_fts JOIN pages p ON p.doc=page_fts.doc AND p.page=page_fts.page
      WHERE page_fts MATCH ? AND page_fts.doc IN (${documentIds.map(() => "?").join(",")})
      ORDER BY rank LIMIT ?`,
      )
      .all(match, ...documentIds, limit) as {
      documentId: string;
      page: number;
      text: string;
      rank: number;
    }[];
  }
  removePages(id: string) {
    this.db.prepare("DELETE FROM pages WHERE doc=?").run(id);
    this.db.prepare("DELETE FROM page_fts WHERE doc=?").run(id);
  }
  document(id: string) {
    return this.get<Document>("document", id);
  }
  conversation(id: string) {
    return this.get<Conversation>("conversation", id);
  }
  turn(id: string) {
    return this.get<Turn>("turn", id);
  }
  pages(doc: string) {
    return this.db
      .prepare("SELECT page,text FROM pages WHERE doc=? ORDER BY page")
      .all(doc) as { page: number; text: string }[];
  }
  page(doc: string, page: number, text: string) {
    this.transaction(() => {
      this.db
        .prepare("INSERT OR REPLACE INTO pages(doc,page,text) VALUES(?,?,?)")
        .run(doc, page, text);
      this.db
        .prepare("DELETE FROM page_fts WHERE doc=? AND page=?")
        .run(doc, page);
      this.db
        .prepare("INSERT INTO page_fts(doc,page,tokens) VALUES(?,?,?)")
        .run(doc, page, tokenize(text).join(" "));
    });
  }
  close() {
    this.db.close();
  }
}
