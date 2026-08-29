import { CONFIG, STORE_DB_NAME, staleTapooLogDatabaseName } from "./config"
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
// Last counts read from the database, kept so an append does not have to re-derive them. An append
// is a hot path - several per turn - and re-counting there cost two extra transactions per entry
// while neither number could have changed in a way the append itself did not cause: the entry count
// goes up by exactly one, and a session can only turn stale by aging past the TTL, which the
// heartbeat notices. init, the heartbeat, and reset all resync these from the database, so a drift
// from anything this module did not do is corrected within one heartbeat rather than persisting.
let cachedCurrentLogCount = 0
let cachedStaleSessionCount = 0

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
//
// Call this immediately after opening the transaction and await the promise later, never the other
// way round. oncomplete/onabort fire once; a transaction that aborts while the caller is still
// awaiting one of its requests fires abort before any handler is attached, and attaching afterwards
// waits for an event that has already happened - the append never settles, and the log write queue
// behind it stops forever.
function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => { resolve() }
    transaction.onerror = () => { reject(indexedDbError(transaction.error)) }
    transaction.onabort = () => { reject(indexedDbError(transaction.error)) }
  })
}

// Drops the cached connection so the next caller opens a fresh one. Used for the failures that are
// genuinely transient - another tab upgrading the database, the browser closing the connection under
// storage pressure or a "clear site data", a write that failed against a handle already dead.
// Without this the module would cache a broken connection for the life of the page and every later
// write would fail silently against it.
function invalidateIndexedDbConnection(): void {
  dbPromise = null
  backend = "session-storage"
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
    // Opened without a version on purpose. The database name carries the schema version, so a
    // schema change opens a different database that starts empty and runs onupgradeneeded to build
    // its stores - the job a version number would otherwise do. Naming one as well would mean two
    // numbers governing one schema, and opening with a version below the one already on disk throws
    // VersionError, which is a way to lose the log to a config edit that looked harmless.
    const request = window.indexedDB.open(STORE_DB_NAME)
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
      const db = request.result
      // Another tab is upgrading: close this handle so it does not block them, and forget it so the
      // next write reopens against the new version rather than throwing InvalidStateError forever.
      db.onversionchange = () => {
        db.close()
        invalidateIndexedDbConnection()
      }
      // Fired when the connection is closed outside our control - storage eviction, or the user
      // clearing site data while the page is open.
      db.onclose = () => { invalidateIndexedDbConnection() }
      backend = "indexed-db"
      resolve(db)
    }
    // Left cached on purpose: a refused open is a property of the browsing context (private mode,
    // blocked site data) and will not change while the page lives, so retrying it on every log entry
    // would spend an open request per write to learn the same answer.
    request.onerror = () => {
      backend = "session-storage"
      resolve(null)
    }
    // Not cached: blocked means another tab still holds an older version open, which ends when that
    // tab does. Forgetting the promise lets a later write succeed instead of stranding this tab on
    // the fallback for as long as the page is open.
    request.onblocked = () => {
      invalidateIndexedDbConnection()
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
  const done = transactionDone(transaction)
  const store = transaction.objectStore(SESSIONS_STORE)
  const id = storageKey(modeName, sessionId)
  const existing = await requestResult(store.get(id) as IDBRequest<StoredLogSession | undefined>)
  const now = Date.now()
  store.put(existing ? { ...existing, lastSeenAt: now } : sessionRecord(sessionId, modeName, now))
  await done
}

// Every lease recorded for one mode, this tab's included. The caller decides which are stale.
async function indexedDbSessionsByMode(
  db: IDBDatabase,
  modeName: MazeControlModeName,
): Promise<StoredLogSession[]> {
  const transaction = db.transaction(SESSIONS_STORE, "readonly")
  const done = transactionDone(transaction)
  const sessions = await requestResult(
    transaction.objectStore(SESSIONS_STORE).index(MODE_INDEX).getAll(modeName) as IDBRequest<StoredLogSession[]>,
  )
  await done
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
  const done = transactionDone(transaction)
  const entries = await requestResult(
    transaction.objectStore(ENTRIES_STORE).index(SESSION_MODE_INDEX).getAll(
      storageKey(modeName, sessionId),
    ) as IDBRequest<StoredLogEntry[]>,
  )
  await done
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
  const done = transactionDone(transaction)
  const count = await requestResult<number>(
    transaction.objectStore(ENTRIES_STORE).index(SESSION_MODE_INDEX).count(storageKey(modeName, sessionId)),
  )
  await done
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

// The state every fallback path reports. Counts what sessionStorage holds for this mode and zero
// stale sessions: the fallback backend has no lease rows, so there is nothing there to go stale.
function sessionStorageState(modeName: MazeControlModeName): TapooLogStoreState {
  return {
    backend: "session-storage",
    currentLogCount: loadTapooLog<LogEntry>(modeName).length,
    staleLogSessionCount: 0,
  }
}

// Opens the store for this tab and reports what it found, without deleting anything. Startup is
// deliberately read-only: stale sessions are counted so the UI can offer a reset, but sweeping them
// here would destroy another tab's logs the moment this one loaded - and two tabs are the normal
// case, not the exception.
//
// The session lease is refreshed only when this tab already has entries. A tab that has logged
// nothing has nothing to protect, so leaving it unleased keeps empty rows from accumulating.
export async function initTapooLogStore(modeName: MazeControlModeName): Promise<TapooLogStoreState> {
  return resyncFromIndexedDb(modeName)
}

// Reads both counts straight from the database and reseeds the cache from them. The three callers
// are the ones that must not trust a cached number: startup has none yet, the heartbeat is where
// another tab's session becomes stale, and a reset has just changed both.
async function resyncFromIndexedDb(modeName: MazeControlModeName): Promise<TapooLogStoreState> {
  const sessionId = currentTapooLogSessionId()
  const db = await openIndexedDb()
  if (!db) {
    return sessionStorageState(modeName)
  }

  const currentLogCount = await indexedDbCurrentCount(db, modeName, sessionId)
  if (currentLogCount > 0) {
    await ensureIndexedDbSession(db, modeName, sessionId)
  }

  cachedCurrentLogCount = currentLogCount
  cachedStaleSessionCount = await indexedDbStaleSessionCount(db, modeName, sessionId)
  return {
    backend: "indexed-db",
    currentLogCount: cachedCurrentLogCount,
    staleLogSessionCount: cachedStaleSessionCount,
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
    return sessionStorageState(modeName)
  }

  try {
    const transaction = db.transaction([ENTRIES_STORE, SESSIONS_STORE], "readwrite")
    const done = transactionDone(transaction)
    const sessions = transaction.objectStore(SESSIONS_STORE)
    const id = storageKey(modeName, sessionId)
    // Read-modify-write inside the transaction already open for the entry, rather than a second one:
    // the lease has to keep the createdAt it was minted with, and rewriting the row wholesale here
    // would reset it on every append - leaving a field that claims to record when the session began
    // while actually recording the last thing written to it.
    const existing = await requestResult(sessions.get(id) as IDBRequest<StoredLogSession | undefined>)
    const now = Date.now()
    sessions.put(existing ? { ...existing, lastSeenAt: now } : sessionRecord(sessionId, modeName, now))
    transaction.objectStore(ENTRIES_STORE).add({
      sessionId,
      sessionMode: id,
      modeName,
      entry,
    } satisfies StoredLogEntry)
    await done

    cachedCurrentLogCount += 1
    return {
      backend: "indexed-db",
      currentLogCount: cachedCurrentLogCount,
      staleLogSessionCount: cachedStaleSessionCount,
    }
  } catch {
    // The write failed - a full quota aborts the transaction, and a connection already closed
    // underneath us throws before one even opens. Neither may end with the entry lost and the caller
    // told nothing: that silence is how a full sessionStorage took a whole session's log down
    // without a trace. Drop the dead connection, write the entry where it can still go, and report
    // the fallback backend so the UI says so.
    invalidateIndexedDbConnection()
    appendTapooLogEntry(modeName, entry)
    return sessionStorageState(modeName)
  }
}

// The synchronous path for browsers with no IndexedDB at all. logTapooRecordEntry is called from hot
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
  return sessionStorageState(modeName)
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
  // Everything awaited inside the transaction below resolves from an IndexedDB event handler, which
  // is what keeps the transaction alive across the loop: a transaction stays active through the
  // microtasks of the task its last event fired in, and dies the moment control returns to the event
  // loop. One await on a timer, a fetch, or any other non-IndexedDB promise in here would commit it
  // early and leave half the sweep done.
  const sessionIds = sessions
    .filter((session) => session.sessionId === sessionId || session.lastSeenAt <= cutoff)
    .map((session) => session.sessionId)

  if (sessionIds.length > 0) {
    const transaction = db.transaction([ENTRIES_STORE, SESSIONS_STORE], "readwrite")
    const done = transactionDone(transaction)
    for (const staleOrCurrentSessionId of sessionIds) {
      await deleteEntriesForSessionMode(transaction, modeName, staleOrCurrentSessionId)
      transaction.objectStore(SESSIONS_STORE).delete(storageKey(modeName, staleOrCurrentSessionId))
    }
    await done
  }

  cachedCurrentLogCount = 0
  cachedStaleSessionCount = await indexedDbStaleSessionCount(db, modeName, sessionId)
  return {
    backend: "indexed-db",
    currentLogCount: cachedCurrentLogCount,
    staleLogSessionCount: cachedStaleSessionCount,
  }
}

// The heartbeat. A tab that is logging keeps renewing its lease so another tab's reset does not
// mistake it for abandoned; the interval is well inside staleSessionTtlMs, so a live tab is never
// one missed beat away from being swept. Like init, it leases only when there are entries to
// protect.
export async function refreshCurrentTapooLogStoreLease(
  modeName: MazeControlModeName,
): Promise<TapooLogStoreState> {
  return resyncFromIndexedDb(modeName)
}

// --- Stale version cleanup ---

// Deletes the log databases an older schema version left behind, one per version, and resolves once
// every attempt has settled.
//
// Nothing else can reach them. The schema version is part of the database name, so a version bump
// does not upgrade the old database - it opens a new one and abandons the old, and
// clearStaleStorageVersions cannot help because it walks localStorage and sessionStorage keys while
// IndexedDB is neither. Left alone, the largest thing Tapoo ever writes - a session's worth of agent
// transcripts - would outlive every reset and every leftover-data confirmation the user gives, while
// the gate that asked for that confirmation counted only the handful of Web Storage keys beside it.
//
// The versions are taken from those stale keys rather than from indexedDB.databases(), which Firefox
// has never implemented: the two always move together, since the version that wrote
// tapoo.v4.82.agentConfigs is the version that wrote tapoo.v4.82.logs. Deleting a database that was
// never created is a no-op, so a version that happened to log nothing costs one harmless request.
//
// Every outcome resolves, including blocked - a delete blocked by another tab's open connection
// still completes once that tab releases it, and waiting here would hold the game behind a tab the
// user may never close.
export async function clearStaleTapooLogDatabases(versions: readonly string[]): Promise<void> {
  if (!hasIndexedDb()) {
    return
  }

  await Promise.all(versions.map((version) => new Promise<void>((resolve) => {
    const name = staleTapooLogDatabaseName(version)
    if (!name) {
      resolve()
      return
    }

    try {
      const request = window.indexedDB.deleteDatabase(name)
      request.onsuccess = () => { resolve() }
      request.onerror = () => { resolve() }
      request.onblocked = () => { resolve() }
    } catch {
      resolve()
    }
  })))
}

export function isTapooLogStorageFallback(): boolean {
  return backend === "session-storage"
}

// Clears the module's cached handle, backend and session id. Exported for tests alone: the cached
// connection promise would otherwise carry one test's database into the next.
export function resetTapooLogStoreForTests(): void {
  dbPromise = null
  backend = "session-storage"
  inMemorySessionId = null
  cachedCurrentLogCount = 0
  cachedStaleSessionCount = 0
}
