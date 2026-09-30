import { useEffect, useRef, useState } from 'react'
import type { Ticket, TicketMessage } from '@/lib/types'

export type TicketLiveEvent =
  | { type: 'ticket'; ticket: Ticket; action: string }
  | { type: 'message' | 'message_update' | 'message_delete'; guildId: string; message: TicketMessage }

// Live stream of ticket events (WebSocket /api/tickets/live), reconnecting on its own
export function useTicketLive(onEvent: (event: TicketLiveEvent) => void) {
  const handler = useRef(onEvent)
  const [live, setLive] = useState(false)

  useEffect(() => {
    handler.current = onEvent
  })

  useEffect(() => {
    let socket: WebSocket | null = null
    let retry: ReturnType<typeof setTimeout> | undefined
    let stopped = false
    const connect = () => {
      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws'
      socket = new WebSocket(`${protocol}://${window.location.host}/api/tickets/live`)
      socket.onopen = () => setLive(true)
      socket.onmessage = (event) => handler.current(JSON.parse(event.data))
      socket.onclose = (event) => {
        setLive(false)
        // 4003: permission removed or session expired
        if (!stopped && event.code !== 4003) retry = setTimeout(connect, 3000)
      }
    }
    connect()
    return () => {
      stopped = true
      clearTimeout(retry)
      socket?.close()
    }
  }, [])

  return live
}
