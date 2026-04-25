"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import SessionHistory from "@/components/SessionHistory"
import { appendLocalMessage, loadLocalMessages, loadLocalSessions, saveLocalSessions } from "@/lib/localStorageSync"
import type { IfcExtractedChatData } from "@/lib/ifc/extractIfcForChat"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"

type ChatMsg = {
  id: string
  role: "user" | "assistant"
  text: string
  suggestedActions?: string[]
  dataQuoted?: any
  citations?: Array<{ doc?: string; section?: string; clause?: string; table?: string; page?: number }>
  complianceResult?: any
  reportUrl?: string | null
  status?: string
  errorCode?: string | null
  attachedFile?: { name: string; type: string; url: string }
}

type ChatContext = {
  depth?: number
  location?: string
  lon?: number
  lat?: number
  include_predictions?: boolean
}

type ChatSession = {
  id: string
  session_title?: string | null
  last_message_at?: string | null
}

function uid() {
  return `${Date.now()}_${Math.random().toString(16).slice(2)}`
}

function getClientId() {
  try {
    const k = "vs_chat_client_id"
    const existing = localStorage.getItem(k)
    if (existing) return existing
    const id = uid()
    localStorage.setItem(k, id)
    return id
  } catch {
    return uid()
  }
}

function getActiveSessionId() {
  try {
    return localStorage.getItem("vs_chat_conversation_id") || ""
  } catch {
    return ""
  }
}

function setActiveSessionId(id: string) {
  try {
    localStorage.setItem("vs_chat_conversation_id", id)
  } catch {}
}

function getUserIdHeader() {
  try {
    const raw = localStorage.getItem("user")
    if (!raw) return null
    const user = JSON.parse(raw)
    return typeof user?.id === "string" ? user.id : null
  } catch {
    return null
  }
}

const introMessage = (): ChatMsg => ({
  id: uid(),
  role: "assistant",
  text: "How can I help you?",
})

export default function ChatbotWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([introMessage()])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [input, setInput] = useState("")
  const [ifcFile, setIfcFile] = useState<File | null>(null)
  const [ifcExtractedData, setIfcExtractedData] = useState<IfcExtractedChatData | null>(null)
  const [ifcExtractBusy, setIfcExtractBusy] = useState(false)
  const [ifcExtractError, setIfcExtractError] = useState<string | null>(null)
  const [ifcExtractSource, setIfcExtractSource] = useState<string | null>(null)
  const [publicIfcUrl, setPublicIfcUrl] = useState("")
  const [publicIfcUrlBusy, setPublicIfcUrlBusy] = useState(false)
  const [publicIfcUrlError, setPublicIfcUrlError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState("Claude is thinking...")
  const [diagBusy, setDiagBusy] = useState(false)
  const [context, setContext] = useState<ChatContext>({ depth: 2.0, include_predictions: true })
  const [llmStatus, setLlmStatus] = useState<{ provider: string; model: string; ok: boolean } | null>(null)
  const clientId = useMemo(() => getClientId(), [])
  const [sessionId, setSessionId] = useState<string>(() => getActiveSessionId() || uid())
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const localIfcObjectUrlRef = useRef<string | null>(null)

  const headers = useCallback(() => {
    const h: Record<string, string> = {
      "content-type": "application/json",
      "x-client-id": clientId,
    }
    const userId = getUserIdHeader()
    if (userId) h["x-user-id"] = userId
    return h
  }, [clientId])

  const refreshSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/sessions", { headers: { "x-client-id": clientId, ...(getUserIdHeader() ? { "x-user-id": getUserIdHeader()! } : {}) } })
      const json = await res.json().catch(() => null)
      if (json?.ok && Array.isArray(json.sessions)) {
        setSessions(json.sessions)
        saveLocalSessions(clientId, json.sessions)
        return
      }
    } catch {}
    const local = loadLocalSessions(clientId)
    if (local.length) setSessions(local as any)
  }, [clientId])

  const loadSession = useCallback(async (id: string) => {
    setSessionId(id)
    setActiveSessionId(id)
    try {
      const res = await fetch(`/api/sessions/${id}/messages`, {
        headers: { "x-client-id": clientId, ...(getUserIdHeader() ? { "x-user-id": getUserIdHeader()! } : {}) },
      })
      const json = await res.json().catch(() => null)
      if (json?.ok && Array.isArray(json.messages) && json.messages.length) {
        const restored: ChatMsg[] = json.messages.map((m: any) => ({
          id: String(m.id ?? uid()),
          role: m.role === "assistant" ? "assistant" : "user",
          text: String(m.content ?? ""),
          citations: Array.isArray(m.citations) ? m.citations : [],
          attachedFile: m.metadata?.attachments?.[0] ? { 
            name: m.metadata.attachments[0].file_name, 
            type: "IFC Model", 
            url: m.metadata.attachments[0].file_url 
          } : undefined
        }))
        setMessages(restored)
        return
      }
    } catch {}
    const local = loadLocalMessages(clientId, id)
    if (local.length) {
      setMessages(local.map((m) => ({ id: m.id, role: m.role, text: m.text })))
      return
    }
    setMessages([introMessage()])
  }, [clientId])

  const createSession = useCallback(async (title = "New Chat", selectIt = true) => {
    try {
      const id = uid()
      const res = await fetch("/api/sessions", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ id, session_title: title }),
      })
      const json = await res.json().catch(() => null)
      const createdId = String(json?.session?.id ?? id)
      if (selectIt) {
        setSessionId(createdId)
        setActiveSessionId(createdId)
        setMessages([introMessage()])
      }
      await refreshSessions()
      return createdId
    } catch {
      const id = uid()
      if (selectIt) {
        setSessionId(id)
        setActiveSessionId(id)
        setMessages([introMessage()])
      }
      return id
    }
  }, [headers, refreshSessions])

  useEffect(() => {
    const onCtx = (ev: any) => {
      const d = ev?.detail ?? {}
      setContext((c) => ({ ...c, ...d }))
    }
    window.addEventListener("vs-chat-context", onCtx as any)
    return () => window.removeEventListener("vs-chat-context", onCtx as any)
  }, [])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current) return
      const t = e.target as Node
      if (!panelRef.current.contains(t)) setOpen(false)
    }
    window.addEventListener("mousedown", onDown)
    return () => window.removeEventListener("mousedown", onDown)
  }, [open])

  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages, loading, open])

  useEffect(() => {
    refreshSessions()
  }, [refreshSessions])

  useEffect(() => {
    if (!open) return
    refreshSessions()
    if (sessionId) loadSession(sessionId)
  }, [open, sessionId, loadSession, refreshSessions])

  const setViewerIfc = useCallback((url: string, fileName: string, navigate = true) => {
    try {
      localStorage.setItem("seismic_ifc_model_url", JSON.stringify({ url, file_name: fileName }))
    } catch {}
    window.dispatchEvent(new CustomEvent("seismic-ifc-model", { detail: { ok: true, model_url: url, file_name: fileName } }))
    if (navigate) window.dispatchEvent(new CustomEvent("seismic-navigate", { detail: { page: "3d-viz" } }))
  }, [])

  const extractIfcInBrowser = useCallback(
    async (args: { buffer: ArrayBuffer; file_name?: string; source_url?: string; source_key: string }): Promise<IfcExtractedChatData | null> => {
      if (ifcExtractBusy && ifcExtractSource === args.source_key) return null
      setIfcExtractBusy(true)
      setIfcExtractError(null)
      setIfcExtractSource(args.source_key)
      try {
        const mod = await import("@/lib/ifc/extractIfcForChat")
        const extracted = await mod.extractIfcForChat({ buffer: args.buffer, file_name: args.file_name, source_url: args.source_url })
        setIfcExtractedData(extracted)
        return extracted
      } catch (e: any) {
        const msg = String(e?.message ?? "IFC extraction failed")
        const shouldFallback = /out of memory|memory|rangeerror|maximum call stack|aborted\(|failed to parse|parse/i.test(msg)

        if (shouldFallback) {
          try {
            const MAX_LITE_BYTES = 10_000_000
            if (args.buffer.byteLength > MAX_LITE_BYTES) throw new Error("IFC is too large for fallback extraction.")
            const dec = new TextDecoder("utf-8")
            const text = dec.decode(new Uint8Array(args.buffer))
            const liteMod = await import("@/lib/ifc-lite")
            const lite = liteMod.parseIfcLite(text)
            const extracted: IfcExtractedChatData = {
              schema: "ifc-extract-v1",
              file_name: args.file_name,
              source_url: args.source_url,
              stats: {
                total_elements:
                  (lite.counts?.columns ?? 0) + (lite.counts?.beams ?? 0) + (lite.counts?.footings ?? 0) + (lite.counts?.walls ?? 0),
                by_type: {
                  IFCCOLUMN: lite.counts?.columns ?? 0,
                  IFCBEAM: lite.counts?.beams ?? 0,
                  IFCFOOTING: lite.counts?.footings ?? 0,
                  IFCWALL: lite.counts?.walls ?? 0,
                },
              },
              quantities: { total_floor_area_m2: null },
              lite_summary: {
                warnings: lite.warnings,
                location: lite.location,
                building: lite.building,
                counts: lite.counts,
                materials: lite.materials,
              },
            }
            setIfcExtractedData(extracted)
            setIfcExtractError("Advanced IFC extraction failed; using limited fallback extraction.")
            return extracted
          } catch (fallbackErr: any) {
            setIfcExtractedData(null)
            setIfcExtractError(`${msg} (fallback failed: ${String(fallbackErr?.message ?? fallbackErr)})`)
            return null
          }
        }

        setIfcExtractedData(null)
        setIfcExtractError(msg)
        return null
      } finally {
        setIfcExtractBusy(false)
      }
    },
    [ifcExtractBusy, ifcExtractSource],
  )

  type PublicIfcUrlValidation = { ok: true; url: string } | { ok: false; error: string }

  const validatePublicIfcUrl = useCallback(
    async (rawUrl: string): Promise<PublicIfcUrlValidation> => {
      const trimmed = rawUrl.trim()
      setPublicIfcUrlError(null)
      if (!trimmed) return { ok: false, error: "Please paste a public IFC URL." }

      let urlObj: URL
      try {
        urlObj = new URL(trimmed)
      } catch {
        const error = "Invalid URL."
        setPublicIfcUrlError(error)
        return { ok: false, error }
      }
      if (urlObj.protocol !== "https:" && urlObj.protocol !== "http:") {
        const error = "URL must start with http:// or https://"
        setPublicIfcUrlError(error)
        return { ok: false, error }
      }
      const pathname = urlObj.pathname.toLowerCase()

      setPublicIfcUrlBusy(true)
      try {
        const head = await fetch(trimmed, { method: "HEAD" })
        if (!head.ok) throw new Error(`URL not reachable (${head.status})`)
        const ct = (head.headers.get("content-type") || "").toLowerCase()
        const cd = (head.headers.get("content-disposition") || "").toLowerCase()
        if (ct.includes("text/html")) throw new Error("URL appears to return HTML, not a raw IFC file.")

        const looksLikeIfc =
          pathname.endsWith(".ifc") || cd.includes(".ifc") || ct.includes("model/ifc") || ct.includes("application/octet-stream")
        if (!looksLikeIfc) throw new Error("URL must directly serve an .ifc file (end with .ifc or return raw file headers).")

        return { ok: true, url: trimmed }
      } catch {
        try {
          const get = await fetch(trimmed, { method: "GET", headers: { Range: "bytes=0-0" } })
          if (!(get.ok || get.status === 206)) throw new Error(`URL not reachable (${get.status})`)
          const ct = (get.headers.get("content-type") || "").toLowerCase()
          const cd = (get.headers.get("content-disposition") || "").toLowerCase()
          if (ct.includes("text/html")) throw new Error("URL appears to return HTML, not a raw IFC file.")

          const looksLikeIfc =
            pathname.endsWith(".ifc") || cd.includes(".ifc") || ct.includes("model/ifc") || ct.includes("application/octet-stream")
          if (!looksLikeIfc) throw new Error("URL must directly serve an .ifc file (end with .ifc or return raw file headers).")

          return { ok: true, url: trimmed }
        } catch (e2: any) {
          const error = String(e2?.message ?? "URL validation failed. Ensure CORS allows access.")
          setPublicIfcUrlError(error)
          return { ok: false, error }
        }
      } finally {
        setPublicIfcUrlBusy(false)
      }
    },
    [],
  )

  const send = async () => {
    const msg = input.trim()
    if ((!msg && !ifcFile && !publicIfcUrl.trim()) || loading) return
    
    const complianceRequested = /\b(analy[sz]e|compliance|check code|is this compliant|bcp|building code)\b/i.test(msg)
    const activeSession = sessionId || (await createSession(msg.slice(0, 60), true))
    setInput("")
    console.log("CHAT_SEND", { has_text: Boolean(msg), has_ifc: Boolean(ifcFile), session_id: activeSession })
    
    let attachedFile: ChatMsg["attachedFile"] = undefined
    if (ifcFile) {
      attachedFile = { name: ifcFile.name, type: "IFC Model", url: "" }
    }
    if (!attachedFile && publicIfcUrl.trim()) {
      const name = publicIfcUrl.trim().split("/").pop() || "model.ifc"
      attachedFile = { name, type: "IFC URL", url: publicIfcUrl.trim() }
    }

    const userMsg: ChatMsg = { 
      id: uid(), 
      role: "user", 
      text: msg || (ifcFile ? "Analyzing uploaded IFC model..." : publicIfcUrl.trim() ? "Visualizing IFC from URL..." : ""),
      attachedFile
    }
    setMessages((m) => [...m, userMsg])
    
    setLoadingText(complianceRequested ? "Analyzing building model against BCP-SP 2021..." : "Claude is thinking...")
    setLoading(true)

    try {
      const assistantId = uid()
      setMessages((m) => [...m, { id: assistantId, role: "assistant", text: "" }])

      let attachments: Array<{ type: "ifc"; file_url: string; file_name?: string }> = []
      let extractedForRequest: IfcExtractedChatData | null = ifcExtractedData

      if (ifcFile) {
        const fileUrl = (() => {
          if (localIfcObjectUrlRef.current) return localIfcObjectUrlRef.current
          const u = URL.createObjectURL(ifcFile)
          localIfcObjectUrlRef.current = u
          return u
        })()

        setViewerIfc(fileUrl, ifcFile.name, !msg || /\b(visualize|3d|viewer|open)\b/i.test(msg))
        setMessages((prev) => prev.map((m) => (m.id === userMsg.id ? { ...m, attachedFile: { ...m.attachedFile!, url: fileUrl } } : m)))

        const key = `file:${ifcFile.name}:${ifcFile.size}`
        if (!extractedForRequest || ifcExtractSource !== key) {
          const buf = await ifcFile.arrayBuffer()
          extractedForRequest = await extractIfcInBrowser({ buffer: buf, file_name: ifcFile.name, source_url: undefined, source_key: key })
        }

        setIfcFile(null)

        if (!msg) {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: "IFC loaded locally. Opening the 3D Visualizer now." } : m)))
          setLoading(false)
          refreshSessions()
          return
        }
      }

      if (!ifcFile && publicIfcUrl.trim()) {
        const result = await validatePublicIfcUrl(publicIfcUrl)
        if (!result.ok) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, text: `URL invalid: ${result.error}` } : m,
            ),
          )
          setLoading(false)
          return
        }

        const validated = result.url
        const fileName = validated.split("/").pop() || "model.ifc"
        attachments.push({ type: "ifc", file_url: validated, file_name: fileName })
        setMessages((prev) =>
          prev.map((m) => (m.id === userMsg.id ? { ...m, attachedFile: { name: fileName, type: "IFC URL", url: validated } } : m)),
        )
        setViewerIfc(validated, fileName, true)
        if (!ifcExtractedData || ifcExtractSource !== `url:${validated}`) {
          const buf = await fetch(validated).then((r) => r.arrayBuffer())
          extractedForRequest = await extractIfcInBrowser({ buffer: buf, file_name: fileName, source_url: validated, source_key: `url:${validated}` })
        }
        setPublicIfcUrl("")

        if (!msg) {
          setMessages((prev) => prev.map((m) => (m.id === assistantId ? { ...m, text: "IFC URL received. Opening the 3D Visualizer now." } : m)))
          setLoading(false)
          refreshSessions()
          return
        }
      }

      // Use the new streaming API
      const ctrl = new AbortController()
      const t = window.setTimeout(() => ctrl.abort(), 30_000)
      const chatStarted = Date.now()
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: headers(),
        signal: ctrl.signal,
        body: JSON.stringify({
          message: msg || "Visualize this IFC file",
          conversation_id: activeSession,
          attachments,
          ifc_extracted_data: extractedForRequest ?? ifcExtractedData ?? undefined,
          context
        }),
      })
      window.clearTimeout(t)
      console.log("CHAT_STREAM_OPEN", { ok: response.ok, ms: Date.now() - chatStarted })

      if (!response.ok) throw new Error("Stream request failed")

      const reader = response.body?.getReader()
      if (!reader) throw new Error("No reader")

      let fullText = ""
      const dec = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = dec.decode(value)
        fullText += chunk
        setMessages((prev) => 
          prev.map((m) => m.id === assistantId ? { ...m, text: fullText } : m)
        )
      }

      // Check for special instructions in fullText (like triggering visualization)
      if (fullText.includes("3d-viz") || attachments.length > 0) {
        // Optional: trigger logic for 3D viz if needed
      }

    } catch (error: any) {
      console.error("Chat error:", error)
      setMessages((m) => [
        ...m,
        { id: uid(), role: "assistant", text: `Error: ${error.message || "Failed to get response"}`, status: "error" },
      ])
    } finally {
      setLoading(false)
      refreshSessions()
    }
  }

  const runAction = (action: string, msg: ChatMsg) => {
    const payload = { action, data: msg.dataQuoted ?? null, context }
    window.dispatchEvent(new CustomEvent("vs-chat-action", { detail: payload }))
    if (action === "Show on map" && msg.dataQuoted) {
      window.dispatchEvent(new CustomEvent("vs-chat-data", { detail: msg.dataQuoted }))
    }
  }

  const generateComplianceReport = async (msgId: string, analysis: any) => {
    try {
      const res = await fetch("/api/generate-compliance-report", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ analysis_results: analysis }),
      })
      const json = await res.json().catch(() => null)
      if (!res.ok || !json?.ok) throw new Error(String(json?.error ?? "Failed to generate report"))
      const url = String(json?.download_url ?? "")
      setMessages((prev) => prev.map((m) => (m.id === msgId ? { ...m, reportUrl: url || null } : m)))
      if (url) window.open(url, "_blank")
    } catch (e: any) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === msgId ? { ...m, text: `${m.text}\n\nReport generation error: ${String(e?.message ?? "unknown error")}` } : m,
        ),
      )
    }
  }

  const runDiagnostics = async () => {
    if (diagBusy) return
    setDiagBusy(true)
    try {
      const [healthRes] = await Promise.all([
        fetch("/api/health", { headers: { "x-client-id": clientId } }),
      ])
      const healthJson = await healthRes.json().catch(() => null)
      const text =
        "Diagnostics:\n\n" +
        "HEALTH CHECK:\n" +
        JSON.stringify(healthJson, null, 2)
      setMessages((m) => [...m, { id: uid(), role: "assistant", text }])
    } catch {
      setMessages((m) => [...m, { id: uid(), role: "assistant", text: "Diagnostics failed. Check server logs." }])
    } finally {
      setDiagBusy(false)
    }
  }

  const contextLabel = (() => {
    const d = typeof context.depth === "number" ? `${context.depth}m` : "N/A"
    const loc = context.location ? String(context.location) : ""
    return loc ? `Using depth=${d}, location=${loc}` : `Using depth=${d}`
  })()

  const onNewChat = async () => {
    await createSession("New Chat", true)
  }

  const onRenameSession = async (id: string) => {
    const next = window.prompt("Rename session", sessions.find((s) => s.id === id)?.session_title ?? "Untitled Session")
    if (!next) return
    try {
      await fetch("/api/sessions", {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ id, session_title: next }),
      })
      await refreshSessions()
    } catch {}
  }

  const onDeleteSession = async (id: string) => {
    if (!window.confirm("Delete this chat session?")) return
    try {
      await fetch(`/api/sessions?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-client-id": clientId, ...(getUserIdHeader() ? { "x-user-id": getUserIdHeader()! } : {}) },
      })
      if (id === sessionId) {
        await createSession("New Chat", true)
      }
      await refreshSessions()
    } catch {}
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="group fixed right-0 top-1/2 -translate-y-1/2 z-[60] rounded-l-2xl bg-[#0d9488] text-white border border-[#0d9488]/60 px-3 py-5 shadow-[0_0_28px_rgba(13,148,136,0.35)] hover:shadow-[0_0_44px_rgba(13,148,136,0.55)] transition transform hover:scale-[1.08]"
        aria-label="Open chat"
      >
        <span className="flex flex-col items-center gap-2">
          <span className="h-8 w-8 rounded-full bg-white/15 border border-white/30 flex items-center justify-center text-sm font-bold">
            G
          </span>
          <span
            className="text-[12px] font-semibold uppercase tracking-[0.32em]"
            style={{ writingMode: "vertical-rl", textOrientation: "mixed" } as any}
          >
            ASK AI
          </span>
          <span className="text-white/90 opacity-0 group-hover:opacity-100 transition group-hover:animate-bounce">
            ←
          </span>
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex justify-end">
          <div
            ref={panelRef}
            className="h-full w-[620px] max-w-[96vw] bg-white shadow-2xl border-l border-gray-300 flex"
          >
            <SessionHistory
              sessions={sessions}
              activeSessionId={sessionId}
              onSelect={loadSession}
              onNewChat={onNewChat}
              onRename={onRenameSession}
              onDelete={onDeleteSession}
            />

            <div className="flex-1 flex flex-col">
              <div className="px-4 py-3 border-b border-gray-300 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-gray-900 tracking-wide">AI Assistant</div>
                  <div className="text-xs text-gray-600 tracking-wide">{contextLabel}</div>
                  {llmStatus ? (
                    <div className="text-[11px] text-gray-500 tracking-wide">
                      LLM: {llmStatus.provider} {llmStatus.ok ? "online" : "offline"} {llmStatus.model ? `(${llmStatus.model})` : ""}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={runDiagnostics}
                    className="rounded-md border border-gray-300 bg-gray-100 px-2 py-1 text-[11px] tracking-wide text-gray-900 hover:bg-gray-200 disabled:opacity-60"
                    disabled={diagBusy}
                  >
                    Diagnostics
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="h-8 w-8 rounded-md hover:bg-gray-200 text-gray-900"
                    aria-label="Close chat"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3 bg-white">
                {messages.map((m, idx) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[85%]">
                      {/* File Attachment */}
                      {m.attachedFile && (
                        <div className="mb-2 flex items-center gap-2 rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-[11px] text-gray-700">
                          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2m0 0v-8m0 8l-6-4m6 4l6-4" />
                          </svg>
                          <span className="truncate font-medium">{m.attachedFile.name}</span>
                          <span className="text-[10px] text-gray-500">({m.attachedFile.type})</span>
                        </div>
                      )}

                      <div
                        className={`rounded-lg px-3 py-2 text-[13px] leading-relaxed tracking-wide ${
                          m.role === "user"
                            ? "bg-[#0d9488] text-white"
                            : "bg-gray-100 text-gray-900 border border-gray-300"
                        }`}
                      >
                        {m.role === "assistant" ? (
                          <div className="prose prose-sm max-w-none prose-p:my-1 prose-table:my-2 prose-th:bg-gray-200 prose-td:border prose-td:px-2 prose-td:py-1">
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {m.text}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <div className="whitespace-pre-wrap">{m.text}</div>
                        )}
                      </div>

                      {/* Message Controls */}
                      <div className="mt-2 flex items-center justify-between gap-2">
                        <div className="flex gap-2">
                          <button
                            onClick={() => navigator.clipboard.writeText(m.text)}
                            className="text-[11px] tracking-wide text-gray-600 hover:text-gray-900"
                            title="Copy message"
                          >
                            📋 Copy
                          </button>
                          {m.role === "user" && idx > 0 && (
                            <button
                              onClick={() => {
                                setInput(m.text)
                                setMessages(messages.slice(0, idx))
                              }}
                              className="text-[11px] tracking-wide text-gray-600 hover:text-gray-900"
                              title="Edit and retry from this message"
                            >
                              ↩️ Retry
                            </button>
                          )}
                          {(idx === messages.length - 1 || m.role === "user") && (
                            <button
                              onClick={() => {
                                setMessages(messages.filter((_, i) => i !== idx))
                              }}
                              className="text-[11px] tracking-wide text-red-600 hover:text-red-900"
                              title="Delete message"
                            >
                              🗑️ Delete
                            </button>
                          )}
                        </div>
                        {m.citations?.length ? (
                          <div className="text-[11px] text-gray-500 tracking-wide">
                            {m.citations.slice(0, 2).map((c, i) => (
                              <span key={i}>
                                {c.doc ?? "code"}
                                {c.section ? ` · ${c.section}` : ""}
                                {c.table ? ` · table ${c.table}` : ""}
                                {c.clause ? ` · clause ${c.clause}` : ""}
                                {i === 0 && m.citations!.length > 1 ? " | " : ""}
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span />
                        )}
                      </div>
                      {m.role === "assistant" && m.suggestedActions?.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.suggestedActions.map((a) => (
                            <button
                              key={a}
                              onClick={() => runAction(a, m)}
                              className="rounded-md border border-gray-300 bg-gray-100 px-2 py-1 text-[11px] tracking-wide text-gray-900 hover:bg-gray-200"
                            >
                              {a}
                            </button>
                          ))}
                        </div>
                      ) : null}
                      {m.role === "assistant" && m.complianceResult ? (
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            onClick={() => generateComplianceReport(m.id, m.complianceResult)}
                            className="rounded-md border border-gray-300 bg-gray-100 px-2 py-1 text-[11px] tracking-wide text-gray-900 hover:bg-gray-200"
                          >
                            Generate Report
                          </button>
                          {m.reportUrl ? (
                            <a href={m.reportUrl} target="_blank" rel="noreferrer" className="text-[11px] text-blue-600 hover:text-blue-700">
                              Download PDF
                            </a>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </div>
                ))}
                {loading ? (
                  <div className="flex justify-start">
                    <div className="max-w-[85%] rounded-lg px-3 py-2 text-[13px] tracking-wide bg-gray-100 text-gray-900 border border-gray-300">
                      {loadingText}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="border-t border-gray-300 p-3">
                <div className="flex gap-2 items-center">
                  <label className="rounded-md border border-gray-300 bg-gray-100 text-gray-900 px-2 py-2 text-sm cursor-pointer hover:bg-gray-200">
                    <input
                      type="file"
                      accept=".ifc"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null
                        if (!f) {
                          setIfcFile(null)
                          return
                        }
                        setIfcFile(f)
                        setIfcExtractedData(null)
                        setIfcExtractError(null)
                        setIfcExtractSource(null)
                        if (localIfcObjectUrlRef.current) {
                          try {
                            URL.revokeObjectURL(localIfcObjectUrlRef.current)
                          } catch {}
                          localIfcObjectUrlRef.current = null
                        }
                        const u = URL.createObjectURL(f)
                        localIfcObjectUrlRef.current = u
                        setViewerIfc(u, f.name, true)
                        f.arrayBuffer()
                          .then((buf) => extractIfcInBrowser({ buffer: buf, file_name: f.name, source_url: undefined, source_key: `file:${f.name}:${f.size}` }))
                          .catch(() => {})
                      }}
                      disabled={loading}
                    />
                    IFC
                  </label>
                  <input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault()
                        send()
                      }
                    }}
                    className="flex-1 rounded-md border border-gray-300 bg-white text-gray-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0d9488]/40"
                    placeholder="How can I help you?"
                  />
                  <button
                    onClick={send}
                    className="rounded-md bg-[#0d9488] px-3 py-2 text-sm text-white hover:bg-[#0f766e] transition disabled:opacity-60"
                    disabled={loading}
                  >
                    Send
                  </button>
                </div>
                <div className="mt-2 flex gap-2 items-center">
                  <input
                    value={publicIfcUrl}
                    onChange={(e) => {
                      setPublicIfcUrl(e.target.value)
                      if (publicIfcUrlError) setPublicIfcUrlError(null)
                    }}
                    onBlur={async () => {
                      if (!publicIfcUrl.trim()) return
                      await validatePublicIfcUrl(publicIfcUrl)
                    }}
                    className="flex-1 rounded-md border border-gray-300 bg-white text-gray-900 px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0d9488]/40"
                    placeholder="Public IFC URL (direct .ifc link)"
                    disabled={loading || publicIfcUrlBusy}
                  />
                  <button
                    onClick={async () => {
                      const result = await validatePublicIfcUrl(publicIfcUrl)
                      if (!result.ok) return
                      const validated = result.url
                      const fileName = validated.split("/").pop() || "model.ifc"
                      setViewerIfc(validated, fileName, true)
                      setIfcExtractedData(null)
                      setIfcExtractError(null)
                      setIfcExtractSource(null)
                      fetch(validated)
                        .then((r) => r.arrayBuffer())
                        .then((buf) => extractIfcInBrowser({ buffer: buf, file_name: fileName, source_url: validated, source_key: `url:${validated}` }))
                        .catch(() => {})
                      setPublicIfcUrl("")
                    }}
                    className="rounded-md border border-[#0d9488]/40 bg-[#0d9488]/10 px-3 py-2 text-sm text-[#0d9488] hover:bg-[#0d9488]/15 transition disabled:opacity-60"
                    disabled={loading || publicIfcUrlBusy || !publicIfcUrl.trim()}
                  >
                    View
                  </button>
                </div>
                {publicIfcUrlError ? <div className="mt-1 text-[11px] text-red-600">{publicIfcUrlError}</div> : null}
                {ifcExtractBusy ? <div className="mt-1 text-[11px] text-gray-600">Extracting IFC data for chat…</div> : null}
                {ifcExtractError ? <div className="mt-1 text-[11px] text-red-600">IFC extraction failed: {ifcExtractError}</div> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
