"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Download, Eye, Trash2 } from "lucide-react"
import type { User } from "@/lib/auth-context"

interface ReportsSectionProps {
  user: User | null
}

interface Report {
  id: string
  report_title?: string | null
  created_at: string
  building_type?: string | null
  report_pdf_url?: string | null
  report_summary?: string | null
  pga_scenario?: number | null
}

function getClientId() {
  try {
    const k = "vs_chat_client_id"
    const existing = localStorage.getItem(k)
    if (existing) return existing
    const id = `${Date.now()}_${Math.random().toString(16).slice(2)}`
    localStorage.setItem(k, id)
    return id
  } catch {
    return `${Date.now()}_${Math.random().toString(16).slice(2)}`
  }
}

function getUserId() {
  try {
    const raw = localStorage.getItem("user")
    if (!raw) return null
    const u = JSON.parse(raw)
    return typeof u?.id === "string" ? u.id : null
  } catch {
    return null
  }
}

export function ReportsSection({ user }: ReportsSectionProps) {
  const [error, setError] = useState<string>("")
  const [generating, setGenerating] = useState(false)
  const [reports, setReports] = useState<Report[]>([])
  const clientId = useMemo(() => getClientId(), [])

  const fetchReports = useCallback(async () => {
    try {
      const headers: Record<string, string> = { "x-client-id": clientId }
      const userId = getUserId()
      if (userId) headers["x-user-id"] = userId
      const res = await fetch("/api/reports", { headers })
      const json = await res.json().catch(() => null)
      if (json?.ok && Array.isArray(json.reports)) setReports(json.reports)
    } catch {}
  }, [clientId])

  useEffect(() => {
    fetchReports()
  }, [fetchReports])

  const generate = async () => {
    setError("")
    setGenerating(true)
    try {
      const raw = localStorage.getItem("seismic_last_location")
      const loc = raw ? JSON.parse(raw) : null
      const lat = Number(loc?.lat)
      const lon = Number(loc?.lon)
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        setError("Select a location in Soil Analysis first (map click) to generate a report.")
        return
      }
      const res = await fetch("/api/generate-report", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-client-id": clientId,
          ...(getUserId() ? { "x-user-id": getUserId()! } : {}),
        },
        body: JSON.stringify({ location: { lat, lon }, pga_scenario: 0.3, building_type: "N/A" }),
      })
      if (!res.ok) {
        setError("Report generation failed")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "report.pdf"
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      await fetchReports()
    } catch {
      setError("Report generation failed")
    } finally {
      setGenerating(false)
    }
  }

  const deleteReport = async (id: string) => {
    try {
      const headers: Record<string, string> = { "x-client-id": clientId }
      const userId = getUserId()
      if (userId) headers["x-user-id"] = userId
      const res = await fetch(`/api/reports?id=${encodeURIComponent(id)}`, { method: "DELETE", headers })
      if (res.ok) await fetchReports()
    } catch {
      setError("Failed to delete report")
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Reports</h2>
          <p className="text-muted-foreground">View and manage project reports</p>
        </div>
        <Button className="bg-primary hover:bg-primary/90" onClick={generate} disabled={generating}>
          {generating ? "Generating..." : "Generate Report"}
        </Button>
      </div>

      {error ? (
        <Card className="p-4 border border-red-500/30 bg-red-500/5 text-red-200">
          <div className="font-medium">Error</div>
          <div className="text-sm">{error}</div>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-6">
          <p className="text-sm text-muted-foreground mb-2">Total Reports</p>
          <p className="text-3xl font-bold text-primary">{reports.length}</p>
        </Card>
        <Card className="p-6">
          <p className="text-sm text-muted-foreground mb-2">Stored PDFs</p>
          <p className="text-3xl font-bold text-chart-3">{reports.filter((r) => !!r.report_pdf_url).length}</p>
        </Card>
        <Card className="p-6">
          <p className="text-sm text-muted-foreground mb-2">Current User</p>
          <p className="text-lg font-bold text-accent">{user?.name ?? "Local Session"}</p>
        </Card>
      </div>

      <div className="space-y-3">
        {reports.map((report) => (
          <Card key={report.id} className="p-6">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="font-semibold text-foreground">{report.report_title || "Preliminary Screening Report"}</h3>
                  <span className="px-2 py-1 rounded text-xs font-medium bg-chart-3/10 text-chart-3">Saved</span>
                </div>
                <div className="flex gap-4 text-sm text-muted-foreground">
                  <span>{report.building_type || "N/A"}</span>
                  <span>{new Date(report.created_at).toLocaleDateString()}</span>
                  <span>{report.pga_scenario != null ? `${Number(report.pga_scenario).toFixed(2)} g` : "PGA N/A"}</span>
                </div>
                {report.report_summary ? <div className="mt-2 text-sm text-muted-foreground">{report.report_summary}</div> : null}
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!report.report_pdf_url}
                  onClick={() => report.report_pdf_url && window.open(report.report_pdf_url, "_blank", "noopener,noreferrer")}
                >
                  <Eye className="w-4 h-4 mr-2" />
                  View
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!report.report_pdf_url}
                  onClick={() => {
                    if (!report.report_pdf_url) return
                    const a = document.createElement("a")
                    a.href = report.report_pdf_url
                    a.download = `${report.report_title || "report"}.pdf`
                    document.body.appendChild(a)
                    a.click()
                    a.remove()
                  }}
                >
                  <Download className="w-4 h-4 mr-2" />
                  Download
                </Button>
                <Button variant="outline" size="sm" onClick={() => deleteReport(report.id)}>
                  <Trash2 className="w-4 h-4 mr-2" />
                  Delete
                </Button>
              </div>
            </div>
          </Card>
        ))}
        {reports.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No saved reports yet. Generate a report from the current map location to store it in Supabase.</Card>
        ) : null}
      </div>
    </div>
  )
}
