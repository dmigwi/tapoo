import { CONFIG, STORE_DB_NAME } from "./config"
import { appendTapooLogEntry, clearTapooLog, loadTapooLog, storageKey, tabStorageKey } from "./storage"
import type {
  LogEntry,
  MazeControlModeName,
  StoredLogEntry,
  StoredLogSession,
  TapooLogBackend,
  TapooLogStoreState,
} from "./types"

const { runtime } = CONFIG

const DB_VERSION = 1

// Named once because every transaction below addresses them: spelling the config path out at each of
// the twenty-odd call sites would bury the store and index being opened inside the lookup that finds
// its name.

const ENTRIES_STORE = runtime.storage.log.stores.entries
const SESSIONS_STORE = runtime.storage.log.stores.sessions
const SESSION_MODE_INDEX = runtime.storage.log.indexes.sessionMode
const MODE_INDEX = runtime.storage.log.indexes.modeName

let inMemorySessionId: string | null = null
let dbPromise: Promise<IDBDatabase | null> | null = null
let backend: TapooLogBackend = "session-storage"

// --- Tab session identity ---

// currentTapooLogSessionId names the browser tab, not the mode played in it. sessionStorage is
// per-tab and IndexedDB is not, so this id is what gives the shared database the tab scoping the old
// sessionStorage log had for free: entries are filed under (session, mode), downloads and resets act
// on the current session alone, and another tab's logs stay untouched and undownloadable from here.
//
// Minted on first use and held in sessionStorage, so it survives reloads within the tab and dies
// with it - after which the entries it labels are unreachable by any live tab and become the stale
// rows the reset path sweeps. The in-memory fallback covers storage being unavailable (private mode,
// blocked cookies): logging still works for the life of the page, and a reload simply starts a new
// session rather than failing.
export function currentTapooLogSessionId(): string {
  try {
    const key = tabStorageKey(runtime.storage.suffixes.logSessionId)
    const stored = window.sessionStorage.getItem(key)
    if (stored) {
      return stored
    }

    const sessionId = String(Date.now())
    window.sessionStorage.setItem(key, sessionId)
    return sessionId
  } catch {
    inMemorySessionId ??= String(Date.now())
    return inMemorySessionId
  }
}

// --- IndexedDB plumbing ---

// Presence, not usability: a browser can expose window.indexedDB and still refuse to open a database
// - private windows, blocked site data, and storage-partitioned third-party contexts all do. So this
// only decides whether opening is worth attempting; the backend is not settled until openIndexedDb
// resolves, which is why callers check its result rather than this. The one caller that treats this
// as final is appendTapooLogStoreFallbackEntrySynchronously, which cannot await an open at all and
// needs an answer before deciding whether the synchronous path applies.
function hasIndexedDb(): boolean {
  return window.indexedDB !== undefined && window.indexedDB !== null
}

// IndexedDB reports failures as DOMException on the request or transaction, and both can be null
// once a connection is torn down. Normalising to an Error keeps the rejection readable rather than
// surfacing "null" at the await.
function indexedDbError(error: unknown): Error {
  if (error instanceof Error) {
    return error
  }
  if (typeof error === "string") {
    return new Error(error)
  }
  return new Error("IndexedDB request failed")
}

// Promisifies one IDBRequest. IndexedDB predates promises, so every read below would otherwise
// carry its own onsuccess/onerror pair.
function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => { resolve(request.result) }
    request.onerror = () => { reject(indexedDbError(request.error)) }
  })
}

// Resolves when a transaction commits, rejecting on error or abort. Awaited after every write: an
// IDBRequest succeeding only means the operation was queued, so returning before the transaction
// completes would report a write that could still roll back.
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => { resolve() }
    transaction.onerror = () => { reject(indexedDbError(transaction.error)) }
    transaction.onabort = () => { reject(indexedDbError(transaction.error)) }
  })
}

// Opens the log database once per page and caches the promise, so concurrent callers share one
// connection rather than racing separate open requests.
//
// Every failure path resolves null rather than rejecting: no IndexedDB, a refused open, or a version
// change blocked by another tab all mean the same thing to a caller - use the fallback. Logging must
// never throw into the game loop, so an unusable database degrades the backend instead of failing
// the turn that tried to log. backend is set here because this is the only place that learns which
// one is actually live.
function openIndexedDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) {
    backend = "session-storage"
    return Promise.resolve(null)
  }

  dbPromise ??= new Promise((resolve) => {
    const request = window.indexedDB.open(STORE_DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(ENTRIES_STORE)) {
        const entries = db.createObjectStore(ENTRIES_STORE, {
          autoIncrement: true,
          keyPath: "id",
        })
        // Name and keyPath are the same string on purpose, and it is also the StoredLogEntry field
        // the index reads. They were three different strings before, so each index was built over a
        // property no record had: every lookup came back empty while the store kept filling, which
        // reads exactly like a store that was never written to.
        entries.createIndex(SESSION_MODE_INDEX, SESSION_MODE_INDEX)
        entries.createIndex(MODE_INDEX, MODE_INDEX)
      }
      if (!db.objectStoreNames.contains(SESSIONS_STORE)) {
        const sessions = db.createObjectStore(SESSIONS_STORE, { keyPath: "id" })
        sessions.createIndex(MODE_INDEX, MODE_INDEX)
      }
    }
    request.onsuccess = () => {
      backend = "indexed-db"
      resolve(request.result)
    }
    request.onerror = () => {
      backend = "session-storage"
      resolve(null)
    }
    request.onblocked = () => {
      backend = "session-storage"
      resolve(null)
    }
  })

  return dbPromise
}

// --- Session leases and staleness ---

// The lastSeenAt below which a session is treated as abandoned. Compared against, never stored.
function staleCutoff(): number {
  return Date.now() - runtime.storage.log.staleSessionTtlMs
}

// Builds a lease row. The id is (mode, session) rather than the session alone: the same tab playing
// both modes holds two leases, so a reset of one mode cannot sweep the other's entries.
function sessionRecord(
  sessionId: string,
  modeName: MazeControlModeName,
  now = Date.now(),
): StoredLogSession {
  return {
    id: storageKey(modeName, sessionId),
    sessionId,
    modeName,
    createdAt: now,
    lastSeenAt: now,
  }
}

// Renews this tab's lease, preserving createdAt so the row still records when the session began.
// Read-modify-write inside one transaction, so a concurrent renewal from another page in the same
// tab cannot interleave and lose the earlier timestamp.
async function ensureIndexedDbSession(
  db: IDBDatabase,
  modeName: MazeControlModeName,
  sessionId: string,
): Promise<void> {
  const transaction = db.transaction(SESSIONS_STORE, "readwrite")
  const store = transaction.objectStore(SESSIONS_STORE)
  const id = storageKey(modeName, sessionId)
  const existing = await requestResult(store.get(id) as IDBRequest<StoredLogSession | undefined>)
  const now = Date.now()
  store.put(existing ? { ...existing, lastSeenAt: now } : sessionRecord(sessionId, modeName, now))
  await transactionDone(transaction)
}

// Every lease recorded for one mode, this tab's included. The caller decides which are stale.
async function indexedDbSessionsByMode(
  db: IDBDatabase,
  modeName: MazeControlModeName,
): Promise<StoredLogSession[]> {
  const transaction = db.transaction(SESSIONS_STORE, "readonly")
  const sessions = await requestResult(
    transaction.objectStore(SESSIONS_STORE).index(MODE_INDEX).getAll(modeName) as IDBRequest<StoredLogSession[]>,
  )
  await transactionDone(transaction)
  return sessions
}

// How many other sessions have gone quiet past the TTL. Counted, not deleted: this drives the UI
// offer to reclaim space, and the deletion only happens when the player accepts it.
async function indexedDbStaleSessionCount(
  db: IDBDatabase,
  modeName: MazeControlModeName,
  currentSessionId: string,
): Promise<number> {
  const cutoff = staleCutoff()
  const sessions = await indexedDbSessionsByMode(db, modeName)
  return sessions.filter((session) =>
    session.sessionId !== currentSessionId && session.lastSeenAt <= cutoff,
  ).length
}

// --- Entry reads and deletes ---

// This tab's entries for one mode, in insertion order - the entries store is autoIncrement, so the
// index returns them in the order they were logged.
async function indexedDbCurrentEntries(
  db: IDBDatabase,
  modeName: MazeControlModeName,
  sessionId: string,
): Promise<LogEntry[]> {
  const transaction = db.transaction(ENTRIES_STORE, "readonly")
  const entries = await requestResult(
    transaction.objectStore(ENTRIES_STORE).index(SESSION_MODE_INDEX).getAll(
      storageKey(modeName, sessionId),
    ) as IDBRequest<StoredLogEntry[]>,
  )
  await transactionDone(transaction)
  return entries.map((record) => record.entry)
}

// Counts through the index rather than loading the entries, so the log count that drives the UI
// does not deserialize a session's worth of payloads on every append.
async function indexedDbCurrentCount(
  db: IDBDatabase,
  modeName: MazeControlModeName,
  sessionId: string,
): Promise<number> {
  const transaction = db.transaction(ENTRIES_STORE, "readonly")
  const count = await requestResult<number>(
    transaction.objectStore(ENTRIES_STORE).index(SESSION_MODE_INDEX).count(storageKey(modeName, sessionId)),
  )
  await transactionDone(transaction)
  return count
}

// Deletes one session's entries for one mode by walking the index with a cursor. A cursor rather
// than getAll-then-delete keeps a whole session's payloads out of memory at once - the reason the
// logs moved off sessionStorage is that a session can be tens of megabytes. Takes the caller's
// transaction so the entries and their lease row are removed atomically.
async function deleteEntriesForSessionMode(
  transaction: IDBTransaction,
  modeName: MazeControlModeName,
  sessionId: string,
): Promise<void> {
  const index = transaction.objectStore(ENTRIES_STORE).index(SESSION_MODE_INDEX)
  const key = storageKey(modeName, sessionId)
  await new Promise<void>((resolve, reject) => {
    const request = index.openCursor(key)
    request.onsuccess = () => {
      const cursor = request.result
      if (!cursor) {
        resolve()
        return
      }
      cursor.delete()
      cursor.continue()
    }
    request.onerror = () => { reject(indexedDbError(request.error)) }
  })
}

// --- Public API ---

// Opens the store for this tab and reports what it found, without deleting anything. Startup is
// deliberately read-only: stale sessions are counted so the UI can offer a reset, but sweeping them
// here would destroy another tab's logs the moment this one loaded - and two tabs are the normal
// case, not the exception.
//
// The session lease is refreshed only when this tab already has entries. A tab that has logged
// nothing has nothing to protect, so leaving it unleased keeps empty rows from accumulating.
export async function initTapooLogStore(modeName: MazeControlModeName): Promise<TapooLogStoreState> {
  const sessionId = currentTapooLogSessionId()
  const db = await openIndexedDb()
  if (!db) {
    return {
      backend: "session-storage",
      currentLogCount: loadTapooLog<LogEntry>(modeName).length,
      staleLogSessionCount: 0,
    }
  }

  const currentLogCount = await indexedDbCurrentCount(db, modeName, sessionId)
  if (currentLogCount > 0) {
    await ensureIndexedDbSession(db, modeName, sessionId)
  }
  return {
    backend: "indexed-db",
    currentLogCount,
    staleLogSessionCount: await indexedDbStaleSessionCount(db, modeName, sessionId),
  }
}

// Writes one entry and renews this tab's lease in the same transaction. Both, together, or neither:
// an entry whose session row failed to write would be unreachable by every later lookup - it is
// found through the sessionMode index - and a lease without entries would keep a dead session alive
// in the stale count. The returned state is read after the write so a caller never sees counts from
// before its own append.
export async function appendTapooLogStoreEntry(
  modeName: MazeControlModeName,
  entry: LogEntry,
): Promise<TapooLogStoreState> {
  const sessionId = currentTapooLogSessionId()
  const db = await openIndexedDb()
  if (!db) {
    appendTapooLogEntry(modeName, entry)
    return {
      backend: "session-storage",
      currentLogCount: loadTapooLog<LogEntry>(modeName).length,
      staleLogSessionCount: 0,
    }
  }

  const now = Date.now()
  const transaction = db.transaction([ENTRIES_STORE, SESSIONS_STORE], "readwrite")
  transaction.objectStore(SESSIONS_STORE).put(sessionRecord(sessionId, modeName, now))
  transaction.objectStore(ENTRIES_STORE).add({
    sessionId,
    sessionMode: storageKey(modeName, sessionId),
    modeName,
    entry,
  } satisfies StoredLogEntry)
  await transactionDone(transaction)
  return {
    backend: "indexed-db",
    currentLogCount: await indexedDbCurrentCount(db, modeName, sessionId),
    staleLogSessionCount: await indexedDbStaleSessionCount(db, modeName, sessionId),
  }
}

// The synchronous path for browsers with no IndexedDB at all. logTapooDiagnostic is called from hot
// paths and cannot await, so when the fallback backend is the only one available the entry is
// written straight to sessionStorage and the caller is told so immediately. Returns null when
// IndexedDB exists, which is the signal to take the async path instead - this must not be used to
// duplicate an entry the async path will also write.
export function appendTapooLogStoreFallbackEntrySynchronously(
  modeName: MazeControlModeName,
  entry: LogEntry,
): TapooLogStoreState | null {
  if (hasIndexedDb()) {
    return null
  }

  appendTapooLogEntry(modeName, entry)
  return {
    backend: "session-storage",
    currentLogCount: loadTapooLog<LogEntry>(modeName).length,
    staleLogSessionCount: 0,
  }
}

// Reads back this tab's entries for one mode, and only this tab's: the download and preview paths
// must never hand over another tab's session, which is what the sessionMode index enforces.
export async function loadCurrentTapooLogStoreEntries(
  modeName: MazeControlModeName,
): Promise<LogEntry[]> {
  const sessionId = currentTapooLogSessionId()
  const db = await openIndexedDb()
  return db ? indexedDbCurrentEntries(db, modeName, sessionId) : loadTapooLog<LogEntry>(modeName)
}

// Reset: drops this tab's entries for the mode, and sweeps stale sessions at the same time. The
// sweep is here rather than at startup because a deliberate reset is the one moment the player has
// asked for deletion - doing it on load would silently discard logs another tab is still writing.
//
// A session counts as stale only when its lease has gone untouched past staleSessionTtlMs, so a live
// tab that simply has not logged recently keeps its entries. Sessions and entries are deleted in one
// transaction, so a partial sweep cannot leave entries with no session to find them by.
export async function clearCurrentAndStaleTapooLogStoreEntries(
  modeName: MazeControlModeName,
): Promise<TapooLogStoreState> {
  const sessionId = currentTapooLogSessionId()
  const db = await openIndexedDb()
  if (!db) {
    clearTapooLog(modeName)
    return { backend: "session-storage", currentLogCount: 0, staleLogSessionCount: 0 }
  }

  const cutoff = staleCutoff()
  const sessions = await indexedDbSessionsByMode(db, modeName)
  const sessionIds = sessions
    .filter((session) => session.sessionId === sessionId || session.lastSeenAt <= cutoff)
    .map((session) => session.sessionId)

  if (sessionIds.length > 0) {
    const transaction = db.transaction([ENTRIES_STORE, SESSIONS_STORE], "readwrite")
    for (const staleOrCurrentSessionId of sessionIds) {
      await deleteEntriesForSessionMode(transaction, modeName, staleOrCurrentSessionId)
      transaction.objectStore(SESSIONS_STORE).delete(storageKey(modeName, staleOrCurrentSessionId))
    }
    await transactionDone(transaction)
  }

  return {
    backend: "indexed-db",
    currentLogCount: 0,
    staleLogSessionCount: await indexedDbStaleSessionCount(db, modeName, sessionId)
  }
}

// The heartbeat. A tab that is logging keeps renewing its lease so another tab's reset does not
// mistake it for abandoned; the interval is well inside staleSessionTtlMs, so a live tab is never
// one missed beat away from being swept. Like init, it leases only when there are entries to
// protect.
export async function refreshCurrentTapooLogStoreLease(
  modeName: MazeControlModeName,
): Promise<TapooLogStoreState> {
  const sessionId = currentTapooLogSessionId()
  const db = await openIndexedDb()
  if (!db) {
    return {
      backend: "session-storage",
      currentLogCount: loadTapooLog<LogEntry>(modeName).length,
      staleLogSessionCount: 0,
    }
  }

  const currentLogCount = await indexedDbCurrentCount(db, modeName, sessionId)
  if (currentLogCount > 0) {
    await ensureIndexedDbSession(db, modeName, sessionId)
  }
  return {
    backend: "indexed-db",
    currentLogCount,
    staleLogSessionCount: await indexedDbStaleSessionCount(db, modeName, sessionId),
  }
}

// Which backend the last open actually produced. Read by the UI to explain the reduced level cap
// that applies when only sessionStorage is available.
export function tapooLogStoreBackend(): TapooLogBackend {
  return backend
}

// Clears the module's cached handle, backend and session id. Exported for tests alone: the cached
// connection promise would otherwise carry one test's database into the next.
export function resetTapooLogStoreForTests(): void {
  dbPromise = null
  backend = "session-storage"
  inMemorySessionId = null
}
