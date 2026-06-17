import { useSyncExternalStore } from "react"

// A tiny global store backed by localStorage so the sidebar and the kata page
// stay in sync without a context provider.

const KEY = "netsec-katas:completed"

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let state: string[] = read()
const listeners = new Set<() => void>()

function emit() {
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot() {
  return state
}

export function toggleKata(id: string) {
  const set = new Set(state)
  if (set.has(id)) set.delete(id)
  else set.add(id)
  state = [...set]
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // ignore write failures (private mode, etc.)
  }
  emit()
}

// Keep multiple tabs in sync.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      state = read()
      emit()
    }
  })
}

export function useProgress() {
  const list = useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
  const completed = new Set(list)
  return {
    completed,
    count: completed.size,
    isDone: (id: string) => completed.has(id),
    toggle: toggleKata,
  }
}
