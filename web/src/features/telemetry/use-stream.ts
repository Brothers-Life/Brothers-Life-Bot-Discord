import { useEffect, useRef, useState } from 'react'

export type StreamStatus = { online?: number | string | null; max?: number | string | null; up?: number | string | null }
export type Tick = {
  status: StreamStatus
  logs: { id: number; ts: string; channel: string | null; level: string | null; line: string }[]
  chat: { id: number; ts: string; player_name: string | null; citizenid: string | null; subtype: string; message: string | null }[]
  sessions: { id: number; ts: string; player_name: string | null; citizenid: string | null }[]
  deaths: { id: number; ts: string; player_name: string | null; citizenid: string | null; cause: string | null; killer_name: string | null; weapon: string | null }[]
  alerts: { id: number; ts: string; kind: string; severity: string; title: string; detail: string | null }[]
}
export type StreamState = 'connecting' | 'on' | 'off'

// Live feed of the telemetry (Server-Sent Events, every 3 s, same-origin session cookie).
// After 5 failures in a row it pauses for a minute before trying again.
export function useTelemetryStream(onTick: (tick: Tick) => void, enabled = true) {
  const handler = useRef(onTick)
  const [state, setState] = useState<StreamState>(() => ('EventSource' in window ? 'connecting' : 'off'))

  useEffect(() => {
    handler.current = onTick
  })

  useEffect(() => {
    if (!enabled) return
    if (!('EventSource' in window)) return
    let source: EventSource | null = null
    let fails = 0
    let retry: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const connect = () => {
      source = new EventSource('/api/telemetry/stream')
      source.addEventListener('open', () => {
        fails = 0
        setState('on')
      })
      source.addEventListener('tick', (event) => {
        try {
          handler.current(JSON.parse((event as MessageEvent).data))
        }
        catch {
          // A broken tick is skipped
        }
      })
      source.addEventListener('error', () => {
        if (stopped) return
        setState('connecting')
        if (++fails >= 5) {
          source?.close()
          setState('off')
          retry = setTimeout(() => {
            fails = 0
            setState('connecting')
            connect()
          }, 60_000)
        }
      })
    }
    connect()
    return () => {
      stopped = true
      clearTimeout(retry)
      source?.close()
    }
  }, [enabled])

  return state
}
