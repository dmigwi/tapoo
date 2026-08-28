import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  appendTapooLogStoreEntry,
  clearCurrentAndStaleTapooLogStoreEntries,
  currentTapooLogSessionId,
  initTapooLogStore,
  loadCurrentTapooLogStoreEntries,
  resetTapooLogStoreForTests,
} from "./storage-logs"
import { tabStorageKey } from "./storage"
import { CONFIG } from "./config"
import type { LogEntry } from "./types"

type FakeRequest<T> = {
  error: unknown
  result: T
  onblocked?: () => void
  onerror?: () => void
  onsuccess?: () => void
  onupgradeneeded?: () => void
}

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

  constructor(private readonly stores: Map<string, FakeObjectStore>) {
    queueMicrotask(() => {
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
    for (const name of Array.isArray(storeNames) ? storeNames : [storeNames]) {
      if (!this.stores.has(name)) {
        throw new Error(`unknown store: ${name}`)
      }
    }
    return new FakeTransaction(this.stores)
  }
}

function installFakeIndexedDb(): void {
  const db = new FakeDatabase()
  const indexedDB = {
    open: (): FakeRequest<FakeDatabase> => {
      const request: FakeRequest<FakeDatabase> = { error: null, result: db }
      queueMicrotask(() => {
        request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    },
  }
  Object.defineProperty(window, "indexedDB", {
    configurable: true,
    value: indexedDB,
  })
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
})
