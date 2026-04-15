"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import SessionHistory from "@/components/SessionHistory"
import { appendLocalMessage, loadLocalMessages, loadLocalSessions, saveLocalSessions } from "@/lib/localStorageSync"

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
  text:
    "Ask me about Vs predictions, uncertainty, soil properties, methodology, limitations, or BCP-SP 2021 screening checks. Examples:\n" +
    '- "Vs at (33.71, 73.08) at 2m"\n' +
    '- "Compare G-6 and I-8 at 2m"\n' +
    '- "What does Vs=250 m/s mean for foundations?"',
})

export default function ChatbotWidget() {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<ChatMsg[]>([introMessage()])
  const [sessions, setSessions] = useState<ChatSession[]>([])
  const [input, setInput] = useState("")
  const [ifcFile, setIfcFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingText, setLoadingText] = useState("Claude is thinking...")
  const [diagBusy, setDiagBusy] = useState(false)
  const [context, setContext] = useState<ChatContext>({ depth: 2.0, include_predictions: true })
  const [llmStatus, setLlmStatus] = useState<{ provider: string; model: string; ok: boolean } | null>(null)
  const clientId = useMemo(() => getClientId(), [])
  const [sessionId, setSessionId] = useState<string>(() => getActiveSessionId() || uid())
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

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

  const send = async () => {
    const msg = input.trim()
    if ((!msg && !ifcFile) || loading) return
    const complianceRequested = /\b(analy[sz]e|compliance|check code|is this compliant|bcp|building code)\b/i.test(msg)
    const activeSession = sessionId || (await createSession(msg.slice(0, 60), true))
    setInput("")
    setIfcFile(null)
    const userMsg: ChatMsg = { id: uid(), role: "user", text: msg }
    setMessages((m) => [...m, userMsg])
    appendLocalMessage(clientId, activeSession, { id: userMsg.id, role: "user", text: msg, created_at: new Date().toISOString(), synced: false })
    setLoadingText(complianceRequested ? "Analyzing building model against BCP-SP 2021..." : "Claude is thinking...")
    setLoading(true)
    try {
      const assistantId = uid()
      setMessages((m) => [...m, { id: assistantId, role: "assistant", text: "" }])

      let attachments: Array<{ type: "ifc"; file_url: string; file_name?: string }> = []
      if (ifcFile) {
        const fd = new FormData()
        fd.append("file", ifcFile)
        const up = await fetch("/api/visualize-ifc", {
          method: "POST",
          headers: { "x-client-id": clientId, ...(getUserIdHeader() ? { "x-user-id": getUserIdHeader()! } : {}) },
          body: fd,
        })
        const upJson = await up.json().catch(() => null)
        if (!up.ok || !upJson?.ok || !upJson?.file_url) {
          const code = String(upJson?.error_code ?? "")
          const err = String(upJson?.error ?? "IFC upload failed")
          const friendly =
            code === "STORAGE_BUCKET_MISSING"
              ? "⚠️ Storage configuration issue.\nPlease create Supabase Storage buckets: ifc_uploads (and reports).\nThen retry the IFC upload."
              : code === "STORAGE_NOT_CONFIGURED"
                ? "⚠️ Storage is not configured on the server.\nSet NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in your deployment.\nThen retry."
                : `Error: ${err}`
          setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, text: friendly, errorCode: code || null } : x)))
          appendLocalMessage(clientId, activeSession, { id: assistantId, role: "assistant", text: friendly, created_at: new Date().toISOString(), synced: false })
          return
        }
        attachments = [{ type: "ifc", file_url: String(upJson.file_url), file_name: String(upJson.file_name ?? ifcFile.name) }]
      }

      const triggerIfcViz = (ifcViz: any) => {
        if (!ifcViz || !ifcViz.ok || !ifcViz.model_url) return
        try {
          localStorage.setItem("seismic_ifc_model_url", JSON.stringify({ url: ifcViz.model_url, file_name: ifcViz.file_name ?? null }))
        } catch {}
        window.dispatchEvent(new CustomEvent("seismic-navigate", { detail: { page: "3d-viz" } }))
        window.dispatchEvent(new CustomEvent("seismic-ifc-model", { detail: ifcViz }))
      }

      const triggerCompliance = (complianceResult: any) => {
        if (!complianceResult || !Array.isArray(complianceResult?.findings)) return
        window.dispatchEvent(new CustomEvent("seismic-compliance-result", { detail: complianceResult }))
      }

      const res = await fetch("/api/chat?stream=1", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ message: msg || "Visualize this IFC file", conversation_id: activeSession, client_id: clientId, context, attachments }),
      })
      const ct = res.headers.get("content-type") ?? ""
      if (!res.ok) {
        const t = await res.text().catch(() => "")
        setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, text: `Error: ${t || "Chat failed"}` } : x)))
        return
      }
      if (!ct.includes("text/event-stream")) {
        const json = await res.json().catch(() => null)
        const text = String(json?.response ?? json?.text ?? "").trim()
        const suggested = Array.isArray(json?.suggested_actions) ? json.suggested_actions : []
        const citations = Array.isArray(json?.citations) ? json.citations : []
        const dataQuoted = json?.data_quoted ?? null
        const complianceResult = json?.compliance_result ?? null
        const status = json?.status ? String(json.status) : ""
        const errorCode = json?.error_code ? String(json.error_code) : null
        setMessages((m) =>
          m.map((x) =>
            x.id === assistantId ? { ...x, text, suggestedActions: suggested, citations, dataQuoted, complianceResult, status, errorCode } : x,
          ),
        )
        appendLocalMessage(clientId, activeSession, { id: assistantId, role: "assistant", text, created_at: new Date().toISOString(), synced: false })
        if (json?.ifc_viz) triggerIfcViz(json.ifc_viz)
        if (complianceResult) triggerCompliance(complianceResult)
        if (json?.llm && typeof json.llm === "object") {
          const p = String(json.llm.provider ?? "anthropic")
          const mm = String(json.llm.model ?? "")
          const ok = Boolean(json.llm.ok)
          setLlmStatus({ provider: p, model: mm, ok })
        }
        await refreshSessions()
        return
      }

      const reader = res.body?.getReader()
      if (!reader) {
        setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, text: "Error: streaming unavailable" } : x)))
        return
      }
      const dec = new TextDecoder()
      let buf = ""
      let meta: any = null
      let streamed = ""

      const applyToken = (t: string) => {
        streamed += t
        setMessages((m) => m.map((x) => (x.id === assistantId ? { ...x, text: (x.text ?? "") + t } : x)))
      }

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        while (true) {
          const idx = buf.indexOf("\n\n")
          if (idx === -1) break
          const frame = buf.slice(0, idx)
          buf = buf.slice(idx + 2)
          const lines = frame.split("\n")
          const ev = lines.find((l) => l.startsWith("event:"))?.slice(6).trim() ?? ""
          const dataLine = lines.find((l) => l.startsWith("data:"))?.slice(5).trim() ?? ""
          const payload = dataLine ? JSON.parse(dataLine) : null
          if (ev === "open") {
            meta = payload
            if (payload?.ifc_viz) triggerIfcViz(payload.ifc_viz)
            if (payload?.compliance_result) triggerCompliance(payload.compliance_result)
          }
          if (ev === "token" && payload?.t) applyToken(String(payload.t))
          if (ev === "done") break
        }
      }

      if (meta?.llm) {
        setLlmStatus({ provider: String(meta.llm.provider ?? "anthropic"), model: String(meta.llm.model ?? ""), ok: Boolean(meta.llm.ok) })
      }
      const citations = Array.isArray(meta?.citations) ? meta.citations : []
      const suggestedActions = Array.isArray(meta?.suggested_actions)
        ? meta.suggested_actions
        : Array.isArray(meta?.suggested_questions)
          ? meta.suggested_questions
          : []
      setMessages((m) =>
        m.map((x) =>
          x.id === assistantId
            ? { ...x, citations, suggestedActions, complianceResult: meta?.compliance_result ?? null }
            : x,
        ),
      )
      appendLocalMessage(clientId, activeSession, { id: assistantId, role: "assistant", text: streamed, created_at: new Date().toISOString(), synced: false })
      await refreshSessions()
    } catch {
      setMessages((m) => [...m, { id: uid(), role: "assistant", text: "Error: request failed" }])
    } finally {
      setLoading(false)
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
      const [envRes, storageRes, dbRes] = await Promise.all([
        fetch("/api/diagnose/env", { headers: { "x-client-id": clientId } }),
        fetch("/api/diagnose/storage", { headers: { "x-client-id": clientId } }),
        fetch("/api/db/diagnose", { headers: { "x-client-id": clientId } }),
      ])
      const envJson = await envRes.json().catch(() => null)
      const storageJson = await storageRes.json().catch(() => null)
      const dbJson = await dbRes.json().catch(() => null)
      const text =
        "Diagnostics:\n\n" +
        "ENV:\n" +
        JSON.stringify(envJson, null, 2) +
        "\n\nSTORAGE:\n" +
        JSON.stringify(storageJson, null, 2) +
        "\n\nDB:\n" +
        JSON.stringify(dbJson, null, 2)
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
        className="group fixed right-0 top-1/2 -translate-y-1/2 z-[60] rounded-l-xl bg-black text-white border border-white/35 px-2 py-3 shadow-[0_0_22px_rgba(255,255,255,0.35)] hover:shadow-[0_0_40px_rgba(255,255,255,0.65)] transition transform hover:scale-[1.06]"
        aria-label="Open chat"
      >
        <span className="flex flex-col items-center gap-2">
          <span className="h-6 w-6 rounded-full bg-white/10 border border-white/25 flex items-center justify-center text-xs font-bold drop-shadow-[0_0_10px_rgba(255,255,255,0.55)]">
            G
          </span>
          <span
            className="text-[11px] font-semibold uppercase tracking-[0.30em] drop-shadow-[0_0_14px_rgba(255,255,255,0.75)]"
            style={{ writingMode: "vertical-rl", textOrientation: "mixed" } as any}
          >
            ASK AI
          </span>
          <span className="text-white/90 opacity-0 group-hover:opacity-100 transition drop-shadow-[0_0_12px_rgba(255,255,255,0.65)] group-hover:animate-bounce">
            ←
          </span>
        </span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex justify-end">
          <div
            ref={panelRef}
            className="h-full w-[620px] max-w-[96vw] bg-black shadow-2xl border-l border-slate-800 flex"
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
              <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white tracking-wide">Vs Assistant</div>
                  <div className="text-xs text-slate-300 tracking-wide">{contextLabel}</div>
                  {llmStatus ? (
                    <div className="text-[11px] text-slate-400 tracking-wide">
                      LLM: {llmStatus.provider} {llmStatus.ok ? "online" : "offline"} {llmStatus.model ? `(${llmStatus.model})` : ""}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={runDiagnostics}
                    className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] tracking-wide text-white hover:bg-slate-800 disabled:opacity-60"
                    disabled={diagBusy}
                  >
                    Diagnostics
                  </button>
                  <button
                    onClick={() => setOpen(false)}
                    className="h-8 w-8 rounded-md hover:bg-slate-900 text-white"
                    aria-label="Close chat"
                  >
                    ×
                  </button>
                </div>
              </div>

              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-4 space-y-3 bg-black">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[85%]">
                      <div
                        className={`whitespace-pre-wrap rounded-lg px-3 py-2 text-[13px] leading-relaxed tracking-wide ${
                          m.role === "user"
                            ? "bg-[#0d9488] text-white"
                            : "bg-slate-900 text-white border border-slate-800"
                        }`}
                      >
                        {m.text}
                      </div>
                      {m.role === "assistant" && m.text ? (
                        <div className="mt-2 flex items-center justify-between gap-2">
                          <button
                            onClick={() => navigator.clipboard.writeText(m.text)}
                            className="text-[11px] tracking-wide text-slate-300 hover:text-white"
                          >
                            Copy
                          </button>
                          {m.citations?.length ? (
                            <div className="text-[11px] text-slate-400 tracking-wide">
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
                      ) : null}
                      {m.role === "assistant" && m.suggestedActions?.length ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {m.suggestedActions.map((a) => (
                            <button
                              key={a}
                              onClick={() => runAction(a, m)}
                              className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-[11px] tracking-wide text-white hover:bg-slate-800"
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
                            className="rounded-md border border-slate-700 bg-slate-900 px-2 py-1 text-[11px] tracking-wide text-white hover:bg-slate-800"
                          >
                            Generate Report
                          </button>
                          {m.reportUrl ? (
                            <a href={m.reportUrl} target="_blank" rel="noreferrer" className="text-[11px] text-sky-300 hover:text-sky-200">
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
                    <div className="max-w-[85%] rounded-lg px-3 py-2 text-[13px] tracking-wide bg-slate-900 text-white border border-slate-800">
                      {loadingText}
                    </div>
                  </div>
                ) : null}
              </div>

              <div className="border-t border-slate-800 p-3">
                <div className="flex gap-2 items-center">
                  <label className="rounded-md border border-slate-700 bg-black text-white px-2 py-2 text-sm cursor-pointer hover:bg-slate-900">
                    <input
                      type="file"
                      accept=".ifc"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0] ?? null
                        setIfcFile(f)
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
                    className="flex-1 rounded-md border border-slate-700 bg-black text-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-[#0d9488]/40"
                    placeholder='Ask e.g. "Vs at 2m in G-6"'
                  />
                  <button
                    onClick={send}
                    className="rounded-md bg-[#0d9488] px-3 py-2 text-sm text-white hover:bg-[#0f766e] transition disabled:opacity-60"
                    disabled={loading}
                  >
                    Send
                  </button>
                </div>
                {ifcFile ? (
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-300">
                    <div className="truncate">Attached: {ifcFile.name}</div>
                    <button className="text-slate-300 hover:text-white" onClick={() => setIfcFile(null)} disabled={loading}>
                      Remove
                    </button>
                  </div>
                ) : null}
                <div className="mt-2 text-[11px] text-slate-300">
                  Research-grade predictions; not a substitute for site-specific geotechnical investigation.
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  )
}
