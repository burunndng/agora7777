import { openDB, type IDBPDatabase } from "idb";
import type { Event as NostrEvent } from "nostr-tools/core";

const DB_NAME = "agora-cache";
const DB_VERSION = 2;
const EVENTS_STORE = "events";
const BOOKMARKS_STORE = "bookmarks";
const KV_STORE = "kv";

type CipherRecord = {
  id: string;
  iv: ArrayBuffer;
  cipher: ArrayBuffer;
  kind: number;
  created_at: number;
  community?: string | null;
};

type BookmarkCipherRecord = {
  id: string;
  iv: ArrayBuffer;
  cipher: ArrayBuffer;
  added_at: number;
};

type KvCipherRecord = {
  key: string;
  iv: ArrayBuffer;
  cipher: ArrayBuffer;
};

export type BookmarkRecord = {
  id: string;
  addedAt: number;
  event?: NostrEvent;
};

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains(EVENTS_STORE)) {
          const store = db.createObjectStore(EVENTS_STORE, { keyPath: "id" });
          store.createIndex("kind", "kind");
          store.createIndex("kind_created_at", ["kind", "created_at"]);
          store.createIndex("community", "community");
          store.createIndex("created_at", "created_at");
        }
        if (oldVersion < 2) {
          if (!db.objectStoreNames.contains(BOOKMARKS_STORE)) {
            const bm = db.createObjectStore(BOOKMARKS_STORE, { keyPath: "id" });
            bm.createIndex("added_at", "added_at");
          }
          if (!db.objectStoreNames.contains(KV_STORE)) {
            db.createObjectStore(KV_STORE, { keyPath: "key" });
          }
        }
      },
    });
  }
  return dbPromise;
}

async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Bind the per-record metadata (id|kind|created_at) to AES-GCM as
 * additional authenticated data so an adversary with disk write cannot
 * silently swap (iv, cipher) pairs across records.
 */
function recordAad(id: string, kind: number, createdAt: number): Uint8Array {
  return new TextEncoder().encode(`${id}|${kind}|${createdAt}`);
}

function bookmarkAad(id: string, addedAt: number): Uint8Array {
  return new TextEncoder().encode(`bookmark|${id}|${addedAt}`);
}

function kvAad(key: string): Uint8Array {
  return new TextEncoder().encode(`kv|${key}`);
}

export class EncryptedEventCache {
  private keyPromise: Promise<CryptoKey> | null;

  constructor(rawKey: Uint8Array) {
    this.keyPromise = importKey(rawKey);
  }

  /**
   * Drop the imported CryptoKey so a process-memory adversary cannot keep
   * decrypting cache entries after the user has logged out. After this is
   * called the cache instance is unusable.
   */
  destroy() {
    this.keyPromise = null;
  }

  private async key(): Promise<CryptoKey> {
    if (!this.keyPromise) throw new Error("cache destroyed");
    return this.keyPromise;
  }

  async putEvent(event: NostrEvent, community?: string | null) {
    const db = await getDB();
    const key = await this.key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(event));
    const aad = recordAad(event.id, event.kind, event.created_at);
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource },
      key,
      data as BufferSource,
    );
    const record: CipherRecord = {
      id: event.id,
      iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
      cipher,
      kind: event.kind,
      created_at: event.created_at,
      community: community ?? null,
    };
    await db.put(EVENTS_STORE, record);
  }

  async putEvents(events: { event: NostrEvent; community?: string | null }[]) {
    if (!events.length) return;
    const db = await getDB();
    const key = await this.key();
    const tx = db.transaction(EVENTS_STORE, "readwrite");
    await Promise.all(
      events.map(async ({ event, community }) => {
        const iv = crypto.getRandomValues(new Uint8Array(12));
        const data = new TextEncoder().encode(JSON.stringify(event));
        const aad = recordAad(event.id, event.kind, event.created_at);
        const cipher = await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource },
          key,
          data as BufferSource,
        );
        await tx.store.put({
          id: event.id,
          iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
          cipher,
          kind: event.kind,
          created_at: event.created_at,
          community: community ?? null,
        } satisfies CipherRecord);
      }),
    );
    await tx.done;
  }

  async getEventsByKind(
    kind: number,
    opts: { community?: string | null; limit?: number } = {},
  ): Promise<NostrEvent[]> {
    const db = await getDB();
    const key = await this.key();
    const records = await db.getAllFromIndex(EVENTS_STORE, "kind", kind);
    const filtered = records
      .filter((r: CipherRecord) =>
        opts.community === undefined ? true : (r.community ?? null) === (opts.community ?? null),
      )
      .sort((a: CipherRecord, b: CipherRecord) => b.created_at - a.created_at)
      .slice(0, opts.limit ?? 200);
    const out: NostrEvent[] = [];
    for (const r of filtered) {
      try {
        const aad = recordAad(r.id, r.kind, r.created_at);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: r.iv, additionalData: aad as BufferSource },
          key,
          r.cipher,
        );
        const ev = JSON.parse(new TextDecoder().decode(plain)) as NostrEvent;
        out.push(ev);
      } catch {
        // skip undecryptable (wrong key, swapped record, or v1 record without AAD)
      }
    }
    return out;
  }

  async clear() {
    const db = await getDB();
    await db.clear(EVENTS_STORE);
  }

  // ---- Bookmarks ---------------------------------------------------------

  async addBookmark(eventId: string, event?: NostrEvent): Promise<void> {
    const db = await getDB();
    const key = await this.key();
    const addedAt = Math.floor(Date.now() / 1000);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const payload = JSON.stringify({ id: eventId, addedAt, event: event ?? null });
    const data = new TextEncoder().encode(payload);
    const aad = bookmarkAad(eventId, addedAt);
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource },
      key,
      data as BufferSource,
    );
    const record: BookmarkCipherRecord = {
      id: eventId,
      iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
      cipher,
      added_at: addedAt,
    };
    await db.put(BOOKMARKS_STORE, record);
  }

  async removeBookmark(eventId: string): Promise<void> {
    const db = await getDB();
    await db.delete(BOOKMARKS_STORE, eventId);
  }

  async listBookmarks(): Promise<BookmarkRecord[]> {
    const db = await getDB();
    const key = await this.key();
    const records = (await db.getAll(BOOKMARKS_STORE)) as BookmarkCipherRecord[];
    records.sort((a, b) => b.added_at - a.added_at);
    const out: BookmarkRecord[] = [];
    for (const r of records) {
      try {
        const aad = bookmarkAad(r.id, r.added_at);
        const plain = await crypto.subtle.decrypt(
          { name: "AES-GCM", iv: r.iv, additionalData: aad as BufferSource },
          key,
          r.cipher,
        );
        const parsed = JSON.parse(new TextDecoder().decode(plain)) as {
          id: string;
          addedAt: number;
          event: NostrEvent | null;
        };
        out.push({
          id: parsed.id,
          addedAt: parsed.addedAt,
          event: parsed.event ?? undefined,
        });
      } catch {
        // skip undecryptable
      }
    }
    return out;
  }

  async listBookmarkIds(): Promise<Set<string>> {
    const db = await getDB();
    const records = (await db.getAll(BOOKMARKS_STORE)) as BookmarkCipherRecord[];
    return new Set(records.map((r) => r.id));
  }

  // ---- Generic encrypted KV ---------------------------------------------

  async kvSet(key: string, value: unknown): Promise<void> {
    const db = await getDB();
    const cryptoKey = await this.key();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = new TextEncoder().encode(JSON.stringify(value));
    const aad = kvAad(key);
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: iv as BufferSource, additionalData: aad as BufferSource },
      cryptoKey,
      data as BufferSource,
    );
    const record: KvCipherRecord = {
      key,
      iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength),
      cipher,
    };
    await db.put(KV_STORE, record);
  }

  async kvGet<T = unknown>(key: string): Promise<T | null> {
    const db = await getDB();
    const cryptoKey = await this.key();
    const record = (await db.get(KV_STORE, key)) as KvCipherRecord | undefined;
    if (!record) return null;
    try {
      const aad = kvAad(key);
      const plain = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: record.iv, additionalData: aad as BufferSource },
        cryptoKey,
        record.cipher,
      );
      return JSON.parse(new TextDecoder().decode(plain)) as T;
    } catch {
      return null;
    }
  }
}

export async function destroyCache() {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => resolve();
    req.onblocked = () => resolve();
  });
}
