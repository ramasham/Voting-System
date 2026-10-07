export const backendBase =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") ?? ""

export class BackendError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message)
  }
}
export async function backendRequest<T>(
  path: string,
  options: {
    token?: string
    method?: string
    body?: unknown
    file?: File
    signal?: AbortSignal
  } = {},
): Promise<T> {
  const headers = new Headers()
  if (options.token) headers.set("Authorization", `Bearer ${options.token}`)
  if (options.file) headers.set("Content-Type", options.file.type)
  else if (options.body !== undefined)
    headers.set("Content-Type", "application/json")
  let response: Response
  try {
    response = await fetch(`${backendBase}${path}`, {
      method: options.method ?? "GET",
      headers,
      signal: options.signal ?? AbortSignal.timeout(20000),
      body:
        options.file ??
        (options.body === undefined ? undefined : JSON.stringify(options.body)),
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error
    throw new BackendError(
      "NETWORK",
      "Unable to connect. Check your connection and try again.",
      0,
    )
  }
  if (response.ok && response.headers.get("Content-Type")?.includes("text/csv"))
    return (await response.blob()) as T
  const payload = (await response.json().catch(() => {
    if (response.ok)
      throw new BackendError(
        "SERVER",
        "The API returned an invalid response.",
        502,
      )
    return {}
  })) as {
    data?: T
    code?: string
    message?: string
  }
  if (!response.ok)
    throw new BackendError(
      payload.code ??
        (response.status === 401
          ? "INVALID_TOKEN"
          : response.status < 500
            ? "VALIDATION"
            : "SERVER"),
      payload.message ?? "The request could not be completed.",
      response.status,
    )
  return ("data" in payload ? payload.data : payload) as T
}
export function mediaUrl(value: string | null | undefined): string {
  if (!value) return ""
  if (value.startsWith("/api/"))
    return new URL(value, new URL(backendBase || "/", window.location.origin))
      .href
  return value
}
export function websocketUrl() {
  const base = new URL(backendBase || "/", window.location.origin)
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:"
  base.pathname = "/ws"
  base.search = ""
  return base.href
}
