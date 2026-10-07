import { useCallback, useEffect, useRef, useState } from "react"
import { staffApi, staffMode } from "../services/staff"
import { websocketUrl } from "../services/backend"
import { DEMO_CHANGE } from "../services/demo-store"
import type { LiveResults } from "../services/staff-types"
import { isExpired } from "./utils"
export type LiveConnection = "connecting" | "live" | "polling" | "offline"
export default function useLiveResults(
  token: string,
  event: string,
  onExpired: () => void,
) {
  const [data, setData] = useState<LiveResults | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [connection, setConnection] = useState<LiveConnection>("connecting")
  const refreshRef = useRef<() => void>(() => {})
  useEffect(() => {
    let alive = true,
      fetching = false,
      pending = false,
      socketLive = false,
      retry = 1000
    let socket: WebSocket | undefined
    let reconnect: ReturnType<typeof setTimeout> | undefined
    let notified: ReturnType<typeof setTimeout> | undefined
    const refresh = async () => {
      if (!alive) return
      if (fetching) {
        pending = true
        return
      }
      fetching = true
      try {
        const next = await staffApi.results(token, event)
        if (alive) {
          setData(next)
          setError(null)
          setConnection(socketLive || staffMode === "mock" ? "live" : "polling")
        }
      } catch (error) {
        if (alive) {
          setError(error)
          setConnection("offline")
          if (isExpired(error)) onExpired()
        }
      } finally {
        fetching = false
        if (pending && alive) {
          pending = false
          void refresh()
        }
      }
    }
    const connect = () => {
      if (!alive || staffMode === "mock") return
      socket = new WebSocket(websocketUrl())
      socket.onopen = () => {
        if (alive) socket?.send(JSON.stringify({ type: "AUTH", token }))
      }
      socket.onmessage = (message) => {
        if (!alive) return
        let payload: {
          type: string
          eventId?: string | number
          code?: string
        }
        try {
          payload = JSON.parse(message.data)
        } catch {
          return
        }
        if (payload.type === "AUTH_SUCCESS")
          socket?.send(
            JSON.stringify({ type: "SUBSCRIBE_RESULTS", eventId: event }),
          )
        if (payload.type === "RESULTS_SUBSCRIBED") {
          socketLive = true
          retry = 1000
          setConnection("live")
        }
        if (
          payload.type === "RESULTS_UPDATED" &&
          String(payload.eventId) === event
        ) {
          clearTimeout(notified)
          notified = setTimeout(() => void refresh(), 150)
        }
        if (payload.type === "AUTH_ERROR") onExpired()
      }
      socket.onclose = (e) => {
        socketLive = false
        if (!alive) return
        if (e.code === 1008) {
          onExpired()
          return
        }
        setConnection((current) =>
          current === "offline" ? current : "polling",
        )
        reconnect = setTimeout(connect, retry)
        retry = Math.min(retry * 2, 30000)
      }
      socket.onerror = () => {
        /* onclose reconnects; polling keeps results available */
      }
    }
    setData(null)
    setError(null)
    setConnection("connecting")
    refreshRef.current = () => void refresh()
    void refresh()
    connect()
    const interval = setInterval(() => {
      if (!document.hidden) void refresh()
    }, 5000)
    const changed = () => void refresh()
    const visible = () => {
      if (!document.hidden) void refresh()
    }
    window.addEventListener("storage", changed)
    window.addEventListener(DEMO_CHANGE, changed)
    window.addEventListener("online", changed)
    document.addEventListener("visibilitychange", visible)
    return () => {
      alive = false
      clearInterval(interval)
      clearTimeout(reconnect)
      clearTimeout(notified)
      socket?.close()
      window.removeEventListener("storage", changed)
      window.removeEventListener(DEMO_CHANGE, changed)
      window.removeEventListener("online", changed)
      document.removeEventListener("visibilitychange", visible)
    }
  }, [token, event, onExpired])
  const refresh = useCallback(() => refreshRef.current(), [])
  return { data, error, connection, refresh }
}
