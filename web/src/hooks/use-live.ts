import { useEffect, useRef, useState } from 'react'

// Live stream of JSON events from a panel WebSocket (e.g. "/api/dms/live"), reconnecting on its own
export function useLive<T>(path: string, onEvent: (event: T) => void) {
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
      socket = new WebSocket(`${protocol}://${window.location.host}${path}`)
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
  }, [path])

  return live
}
