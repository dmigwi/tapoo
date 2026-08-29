import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  appendTapooLogStoreEntry,
  clearCurrentAndStaleTapooLogStoreEntries,
  clearStaleTapooLogDatabases,
  currentTapooLogSessionId,
  initTapooLogStore,
  loadCurrentTapooLogStoreEntries,
  refreshCurrentTapooLogStoreLease,
  resetTapooLogStoreForTests,
  tapooLogStoreBackend,
} from "./storage-logs"
import { loadTapooLog, tabStorageKey } from "./storage"
import { CONFIG, STORE_DB_NAME, staleTapooLogDatabaseName } from "./config"
import type { LogEntry } from "./types"

type FakeRequest<T> = {
  error: unknown
  result: T
  onblocked?: () => void
  onerror?: () => void
  onsuccess?: () => void
  onupgradeneeded?: () => void
}

const SESSIONS_STORE_NAME = CONFIG.runtime.storage.log.stores.sessions

function createMemoryStorage(): Storage {
  const values = new Map<string, string>()

  return {
    get length() {
      return values.size
    },
    clear() {
      values.clear()
    },
    getItem(key) {
      return values.get(key) ?? null
    },
    key(index) {
      return Array.from(values.keys())[index] ?? null
    },
    removeItem(key) {
      values.delete(key)
    },
    setItem(key, value) {
      values.set(key, value)
    },
  }
}

function resolveRequest<T>(result: T): FakeRequest<T> {
  const request: FakeRequest<T> = { error: null, result }
  queueMicrotask(() => { request.onsuccess?.() })
  return request
}

class FakeObjectStore {
  constructor(
    private readonly records: Map<number | string, unknown>,
    private readonly keyPath: string,
    private nextKey: { value: number },
  ) {}

  add(value: Record<string, unknown>): FakeRequest<unknown> {
    const key = this.nextKey.value
    this.nextKey.value += 1
    this.records.set(key, { ...value, [this.keyPath]: key })
    return resolveRequest(key)
  }

  createIndex(): void {}

  delete(key: number | string): FakeRequest<undefined> {
    this.records.delete(key)
    return resolveRequest(undefined)
  }

  get(key: number | string): FakeRequest<unknown> {
    return resolveRequest(this.records.get(key))
  }

  index(name: string): FakeIndex {
    return new FakeIndex(this.records, name)
  }

  put(value: Record<string, unknown>): FakeRequest<unknown> {
    this.records.set(value[this.keyPath] as number | string, value)
    return resolveRequest(value[this.keyPath])
  }
}

class FakeIndex {
  constructor(
    private readonly records: Map<number | string, unknown>,
    private readonly name: string,
  ) {}

  count(value: unknown): FakeRequest<number> {
    return resolveRequest(this.matchingRecords(value).length)
  }

  getAll(value: unknown): FakeRequest<unknown[]> {
    return resolveRequest(this.matchingRecords(value))
  }

  openCursor(value: unknown): FakeRequest<FakeCursor | null> {
    const matches = [...this.records.entries()].filter(([, record]) =>
      (record as Record<string, unknown>)[this.name] === value,
    )
    const request: FakeRequest<FakeCursor | null> = { error: null, result: null }
    let index = 0
    const advance = (): void => {
      const match = matches[index]
      request.result = match
        ? new FakeCursor(this.records, match[0], advance)
        : null
      queueMicrotask(() => { request.onsuccess?.() })
      index += 1
    }
    queueMicrotask(advance)
    return request
  }

  private matchingRecords(value: unknown): unknown[] {
    return [...this.records.values()].filter((record) =>
      (record as Record<string, unknown>)[this.name] === value,
    )
  }
}

class FakeCursor {
  constructor(
    private readonly records: Map<number | string, unknown>,
    private readonly key: number | string,
    private readonly advance: () => void,
  ) {}

  continue(): void {
    this.advance()
  }

  delete(): FakeRequest<undefined> {
    this.records.delete(this.key)
    return resolveRequest(undefined)
  }
}

class FakeTransaction {
  error: unknown = null
  onabort?: () => void
  onerror?: () => void
  private completed = false
  private completeHandler?: () => void

  constructor(private readonly stores: Map<string, FakeObjectStore>, aborts = false) {
    queueMicrotask(() => {
      if (aborts) {
        this.error = new DOMException("quota exceeded", "QuotaExceededError")
        this.onabort?.()
        return
      }
      this.completed = true
      this.completeHandler?.()
    })
  }

  get oncomplete(): (() => void) | undefined {
    return this.completeHandler
  }

  set oncomplete(handler: (() => void) | undefined) {
    this.completeHandler = handler
    if (handler && this.completed) {
      queueMicrotask(handler)
    }
  }

  objectStore(name: string): FakeObjectStore {
    const store = this.stores.get(name)
    if (!store) {
      throw new Error(`unknown store: ${name}`)
    }
    return store
  }
}

class FakeDatabase {
  readonly objectStoreNames = {
    contains: (name: string) => this.stores.has(name),
  }

  // Assigned by storage-logs so it can drop a connection the browser has taken away; the tests fire
  // them to stand in for another tab upgrading the database or the user clearing site data.
  onversionchange?: () => void
  onclose?: () => void
  // "throw" is a handle already closed underneath us (IndexedDB raises InvalidStateError before a
  // transaction exists); "abort" is a write the quota refused once it was underway.
  failureMode: "none" | "throw" | "abort" = "none"
  transactionCount = 0
  closed = false

  close(): void {
    this.closed = true
  }

  private readonly records = new Map<string, Map<number | string, unknown>>()
  private readonly keyPaths = new Map<string, string>()
  private readonly nextKeys = new Map<string, { value: number }>()
  private readonly stores = new Map<string, FakeObjectStore>()

  createObjectStore(name: string, options: { keyPath: string }): FakeObjectStore {
    this.records.set(name, new Map())
    this.keyPaths.set(name, options.keyPath)
    this.nextKeys.set(name, { value: 1 })
    const store = new FakeObjectStore(
      this.records.get(name) ?? new Map<number | string, unknown>(),
      options.keyPath,
      this.nextKeys.get(name) ?? { value: 1 },
    )
    this.stores.set(name, store)
    return store
  }

  transaction(storeNames: string | string[]): FakeTransaction {
    this.transactionCount += 1
    if (this.failureMode === "throw") {
      throw new DOMException("connection is closed", "InvalidStateError")
    }
    for (const name of Array.isArray(storeNames) ? storeNames : [storeNames]) {
      if (!this.stores.has(name)) {
        throw new Error(`unknown store: ${name}`)
      }
    }
    return new FakeTransaction(this.stores, this.failureMode === "abort")
  }

  // Reads the lease rows directly. createdAt and lastSeenAt are not observable through the module's
  // own API, and the whole point of the append path preserving createdAt is that the field keeps
  // meaning something, so a test has to look at the stored row itself.
  readSessions(): Array<Record<string, unknown>> {
    return [...(this.records.get(SESSIONS_STORE_NAME)?.values() ?? [])] as Array<Record<string, unknown>>
  }
}

type FakeIndexedDb = {
  openNames: string[]
  openVersions: number[]
  deletedDatabases: string[]
  db: FakeDatabase
  // Makes the next open report blocked instead of succeeding, the way a browser does while another
  // tab still holds an older version of the database open.
  blockNextOpen: () => void
}

function installFakeIndexedDb(): FakeIndexedDb {
  const db = new FakeDatabase()
  const openNames: string[] = []
  const openVersions: number[] = []
  const deletedDatabases: string[] = []
  let blockNext = false
  const indexedDB = {
    open: (name: string, version?: number): FakeRequest<FakeDatabase> => {
      openNames.push(name)
      if (version !== undefined) {
        openVersions.push(version)
      }
      const request: FakeRequest<FakeDatabase> = { error: null, result: db }
      const wasBlocked = blockNext
      blockNext = false
      queueMicrotask(() => {
        if (wasBlocked) {
          request.onblocked?.()
          return
        }
        request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
    deleteDatabase: (name: string): FakeRequest<undefined> => {
      deletedDatabases.push(name)
      return resolveRequest(undefined)
    },
  }
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: indexedDB,
  })
  return {
    openNames,
    openVersions,
    deletedDatabases,
    db,
    blockNextOpen: () => { blockNext = true },
  }
}

function logEntry(payload: string): LogEntry {
  return {
    epochMs: Date.now(),
    time: "2026-08-28T13-00-00+02-00",
    level: 1,
    turn: 0,
    game: 1,
    log: "info",
    payload,
  }
}

// Built from the same helper and suffix production uses: a literal here drifted from the real key
// once already, and the store then read as empty rather than failing.
function setTabSession(sessionId: string): void {
  window.sessionStorage.setItem(
    tabStorageKey(CONFIG.runtime.storage.suffixes.logSessionId),
    sessionId,
  )
}

describe("IndexedDB Tapoo log store", () => {
  let now = 0

  beforeEach(() => {
    now = Date.parse("2026-08-28T11:00:00Z")
    vi.spyOn(Date, "now").mockImplementation(() => now)
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: createMemoryStorage(),
    })
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      value: createMemoryStorage(),
    })
    installFakeIndexedDb()
    resetTapooLogStoreForTests()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetTapooLogStoreForTests()
  })

  it("uses the current timestamp in milliseconds as a new tab session id", () => {
    expect(currentTapooLogSessionId()).toBe(String(now))
  })

  // The database name carries the schema version, so the open needs no version of its own: a schema
  // change opens a different database, which starts empty and builds its stores through
  // onupgradeneeded. Naming a version as well is a second number to keep in step with the first, and
  // one below the version already on disk throws VersionError - losing the log to a config edit.
  it("opens the versioned log database without an IndexedDB version of its own", async () => {
    const { openVersions, openNames } = installFakeIndexedDb()
    resetTapooLogStoreForTests()

    await initTapooLogStore("agent-api")

    expect(openNames).toEqual([STORE_DB_NAME])
    expect(openVersions).toEqual([])
  })

  it("stores logs under the current tab session and mode", async () => {
    setTabSession("tab-a")

    await appendTapooLogStoreEntry("agent-api", logEntry("agent request"))
    await appendTapooLogStoreEntry("interactive", logEntry("interactive event"))

    expect(currentTapooLogSessionId()).toBe("tab-a")
    expect(await loadCurrentTapooLogStoreEntries("agent-api")).toEqual([
      expect.objectContaining({ payload: "agent request" }),
    ])
    expect(await loadCurrentTapooLogStoreEntries("interactive")).toEqual([
      expect.objectContaining({ payload: "interactive event" }),
    ])
  })

  it("keeps two tab sessions from mixing download/reset scopes", async () => {
    setTabSession("tab-a")
    await appendTapooLogStoreEntry("agent-api", logEntry("tab a"))
    setTabSession("tab-b")
    await appendTapooLogStoreEntry("agent-api", logEntry("tab b"))

    expect(await loadCurrentTapooLogStoreEntries("agent-api")).toEqual([
      expect.objectContaining({ payload: "tab b" }),
    ])

    await clearCurrentAndStaleTapooLogStoreEntries("agent-api")

    expect(await loadCurrentTapooLogStoreEntries("agent-api")).toEqual([])
    setTabSession("tab-a")
    expect(await loadCurrentTapooLogStoreEntries("agent-api")).toEqual([
      expect.objectContaining({ payload: "tab a" }),
    ])
  })

  it("counts stale same-mode sessions without deleting them on startup", async () => {
    setTabSession("old-tab")
    await appendTapooLogStoreEntry("agent-api", logEntry("old"))
    now += CONFIG.runtime.storage.log.staleSessionTtlMs

    setTabSession("current-tab")
    const state = await initTapooLogStore("agent-api")

    expect(state.staleLogSessionCount).toBe(1)
    setTabSession("old-tab")
    expect(await loadCurrentTapooLogStoreEntries("agent-api")).toEqual([
      expect.objectContaining({ payload: "old" }),
    ])
  })

  it("does not classify another session as stale before the TTL expires", async () => {
    setTabSession("fresh-tab")
    await appendTapooLogStoreEntry("agent-api", logEntry("fresh"))
    now += CONFIG.runtime.storage.log.staleSessionTtlMs - 1

    setTabSession("current-tab")
    const state = await initTapooLogStore("agent-api")

    expect(state.staleLogSessionCount).toBe(0)
  })

  it("classifies another session as stale exactly when the TTL expires", async () => {
    setTabSession("ttl-boundary-tab")
    await appendTapooLogStoreEntry("agent-api", logEntry("ttl boundary"))
    now += CONFIG.runtime.storage.log.staleSessionTtlMs

    setTabSession("current-tab")
    const state = await initTapooLogStore("agent-api")

    expect(state.staleLogSessionCount).toBe(1)
  })

  it("classifies another session as stale after the TTL expires", async () => {
    setTabSession("stale-tab")
    await appendTapooLogStoreEntry("agent-api", logEntry("stale"))
    now += CONFIG.runtime.storage.log.staleSessionTtlMs + 1

    setTabSession("current-tab")
    const state = await initTapooLogStore("agent-api")

    expect(state.staleLogSessionCount).toBe(1)
  })

  it("does not count the current session as stale even when its lease is old", async () => {
    setTabSession("current-tab")
    await appendTapooLogStoreEntry("agent-api", logEntry("current"))
    now += CONFIG.runtime.storage.log.staleSessionTtlMs

    const state = await initTapooLogStore("agent-api")

    expect(state.currentLogCount).toBe(1)
    expect(state.staleLogSessionCount).toBe(0)
  })

  it("does not count stale sessions from another mode", async () => {
    setTabSession("old-interactive-tab")
    await appendTapooLogStoreEntry("interactive", logEntry("old interactive"))
    now += CONFIG.runtime.storage.log.staleSessionTtlMs

    setTabSession("current-tab")
    const agentState = await initTapooLogStore("agent-api")
    const interactiveState = await initTapooLogStore("interactive")

    expect(agentState.staleLogSessionCount).toBe(0)
    expect(interactiveState.staleLogSessionCount).toBe(1)
  })

  it("reset clears current-session logs plus stale same-mode logs", async () => {
    setTabSession("old-tab")
    await appendTapooLogStoreEntry("agent-api", logEntry("old"))
    now += CONFIG.runtime.storage.log.staleSessionTtlMs
    setTabSession("fresh-other-tab")
    await appendTapooLogStoreEntry("agent-api", logEntry("fresh other tab"))
    setTabSession("current-tab")
    await appendTapooLogStoreEntry("agent-api", logEntry("current"))

    await clearCurrentAndStaleTapooLogStoreEntries("agent-api")

    expect(await loadCurrentTapooLogStoreEntries("agent-api")).toEqual([])
    setTabSession("old-tab")
    expect(await loadCurrentTapooLogStoreEntries("agent-api")).toEqual([])
    setTabSession("fresh-other-tab")
    expect(await loadCurrentTapooLogStoreEntries("agent-api")).toEqual([
      expect.objectContaining({ payload: "fresh other tab" }),
    ])
  })

  it("refreshes lastSeenAt only for sessions that already have logs", async () => {
    setTabSession("empty-tab")
    now += CONFIG.runtime.storage.log.staleSessionTtlMs

    const emptyState = await initTapooLogStore("agent-api")

    expect(emptyState.currentLogCount).toBe(0)
    expect(emptyState.staleLogSessionCount).toBe(0)

    await appendTapooLogStoreEntry("agent-api", logEntry("first"))
    now += CONFIG.runtime.storage.log.staleSessionTtlMs - 1

    const activeState = await initTapooLogStore("agent-api")

    expect(activeState.currentLogCount).toBe(1)
    expect(activeState.staleLogSessionCount).toBe(0)
  })

  it("keeps running agent-api logs fresh when successful writes keep renewing the lease", async () => {
    setTabSession("running-tab")
    await appendTapooLogStoreEntry("agent-api", logEntry("first running log"))
    now += CONFIG.runtime.storage.log.staleSessionTtlMs - 1
    await appendTapooLogStoreEntry("agent-api", logEntry("second running log"))
    now += CONFIG.runtime.storage.log.staleSessionTtlMs - 1

    setTabSession("current-tab")
    const state = await initTapooLogStore("agent-api")

    expect(state.staleLogSessionCount).toBe(0)
    setTabSession("running-tab")
    expect(await loadCurrentTapooLogStoreEntries("agent-api")).toEqual([
      expect.objectContaining({ payload: "first running log" }),
      expect.objectContaining({ payload: "second running log" }),
    ])
  })

  it("keeps the createdAt a session was minted with as later entries renew its lease", async () => {
    const { db } = installFakeIndexedDb()
    resetTapooLogStoreForTests()
    setTabSession("long-lived-tab")
    const mintedAt = now

    await appendTapooLogStoreEntry("agent-api", logEntry("first"))
    now += 60_000
    await appendTapooLogStoreEntry("agent-api", logEntry("second"))

    // Rewriting the row wholesale on each append would leave createdAt tracking the newest write,
    // which is what lastSeenAt already records - the field would then say nothing at all.
    const session = db.readSessions()[0]
    expect(session).toMatchObject({ createdAt: mintedAt, lastSeenAt: mintedAt + 60_000 })
  })

  it("issues one transaction per append rather than re-counting the store each time", async () => {
    const { db } = installFakeIndexedDb()
    resetTapooLogStoreForTests()
    setTabSession("busy-tab")

    await appendTapooLogStoreEntry("agent-api", logEntry("first"))
    const afterFirst = db.transactionCount
    const second = await appendTapooLogStoreEntry("agent-api", logEntry("second"))

    // Appends run several times a turn. Re-deriving both counts from the database on each one cost
    // two extra transactions to learn numbers the append itself already determined.
    expect(db.transactionCount - afterFirst).toBe(1)
    expect(second.currentLogCount).toBe(2)
    expect((await loadCurrentTapooLogStoreEntries("agent-api")).length).toBe(2)
  })

  it("writes the entry to sessionStorage and reports the fallback when an IndexedDB write fails", async () => {
    const { db } = installFakeIndexedDb()
    resetTapooLogStoreForTests()
    setTabSession("full-tab")
    await appendTapooLogStoreEntry("agent-api", logEntry("before the quota filled"))

    db.failureMode = "abort"
    const state = await appendTapooLogStoreEntry("agent-api", logEntry("after the quota filled"))

    // Losing the entry and telling the caller nothing is how a full sessionStorage took a whole
    // session's log down without a trace. The entry has to land somewhere, and the backend it
    // landed in has to be what the caller is told.
    expect(state.backend).toBe("session-storage")
    expect(tapooLogStoreBackend()).toBe("session-storage")
    expect(loadTapooLog<LogEntry>("agent-api")).toEqual([
      expect.objectContaining({ payload: "after the quota filled" }),
    ])
  })

  it("reopens the database after another tab's version change closes the connection", async () => {
    const fake = installFakeIndexedDb()
    resetTapooLogStoreForTests()
    setTabSession("upgraded-tab")
    await appendTapooLogStoreEntry("agent-api", logEntry("before the upgrade"))
    const opensBefore = fake.openNames.length

    // What the browser does when another tab opens a newer version: the handle is revoked, and every
    // later transaction on it would throw InvalidStateError.
    fake.db.onversionchange?.()

    expect(fake.db.closed).toBe(true)
    const state = await appendTapooLogStoreEntry("agent-api", logEntry("after the upgrade"))

    expect(fake.openNames.length).toBe(opensBefore + 1)
    expect(state.backend).toBe("indexed-db")
    expect(await loadCurrentTapooLogStoreEntries("agent-api")).toEqual([
      expect.objectContaining({ payload: "before the upgrade" }),
      expect.objectContaining({ payload: "after the upgrade" }),
    ])
  })

  it("retries a blocked open on the next write instead of staying on the fallback", async () => {
    const fake = installFakeIndexedDb()
    resetTapooLogStoreForTests()
    setTabSession("blocked-tab")
    fake.blockNextOpen()

    const blocked = await appendTapooLogStoreEntry("agent-api", logEntry("while blocked"))
    expect(blocked.backend).toBe("session-storage")

    // Blocked ends when the tab holding the older version closes. Caching that answer for the life
    // of the page would strand this tab on sessionStorage long after the block cleared.
    const afterBlock = await appendTapooLogStoreEntry("agent-api", logEntry("after the block"))
    expect(afterBlock.backend).toBe("indexed-db")
  })

  it("deletes the log database an older schema version left behind", async () => {
    const { deletedDatabases } = installFakeIndexedDb()
    resetTapooLogStoreForTests()

    await clearStaleTapooLogDatabases(["4.82", "4.9"])

    // The schema version is part of the database name, so an upgrade abandons the old database
    // rather than migrating it - and no Web Storage sweep can see it.
    expect(deletedDatabases).toEqual([
      staleTapooLogDatabaseName("4.82"),
      staleTapooLogDatabaseName("4.9"),
    ])
    expect(deletedDatabases).not.toContain(STORE_DB_NAME)
  })

  // The versions reaching the sweep are parsed out of leftover storage keys, so a bad parse - or a
  // future caller passing the wrong thing - would aim a deleteDatabase at the log the tab is
  // actively writing. The name of the live database is not one this path is able to produce.
  it("refuses to delete the database the current version is writing to", async () => {
    const { deletedDatabases } = installFakeIndexedDb()
    resetTapooLogStoreForTests()

    await clearStaleTapooLogDatabases([String(CONFIG.runtime.storage.version), "4.82"])

    expect(deletedDatabases).toEqual([staleTapooLogDatabaseName("4.82")])
  })

  it("leaves the current version's database alone when there is nothing stale", async () => {
    const { deletedDatabases } = installFakeIndexedDb()
    resetTapooLogStoreForTests()

    await clearStaleTapooLogDatabases([])

    expect(deletedDatabases).toEqual([])
  })

  it("keeps stopped agent-api logs fresh when the heartbeat renews the lease", async () => {
    setTabSession("stopped-tab")
    await appendTapooLogStoreEntry("agent-api", logEntry("stopped log"))
    now += CONFIG.runtime.storage.log.staleSessionTtlMs - 1

    await refreshCurrentTapooLogStoreLease("agent-api")
    now += CONFIG.runtime.storage.log.staleSessionTtlMs - 1

    setTabSession("current-tab")
    const state = await initTapooLogStore("agent-api")

    expect(state.staleLogSessionCount).toBe(0)
    setTabSession("stopped-tab")
    expect(await loadCurrentTapooLogStoreEntries("agent-api")).toEqual([
      expect.objectContaining({ payload: "stopped log" }),
    ])
  })
})
