"use client"

import { useEffect, useState } from "react"

import { Card } from "@/components/ui/card"
import PermitStatus from "@/components/permit/PermitStatus"

export default function MyApplicationsPage() {
  const [apps, setApps] = useState<any[]>([])
  const [error, setError] = useState("")

  useEffect(() => {
    const run = async () => {
      try {
        const res = await fetch("/api/permit/applications")
        const json = await res.json().catch(() => null)
        if (!json?.ok) {
          setError(String(json?.error ?? "failed"))
          return
        }
        setApps(Array.isArray(json.applications) ? json.applications : [])
      } catch {
        setError("failed")
      }
    }
    run()
  }, [])

  return (
    <div className="p-8 space-y-4">
      <div>
        <div className="text-2xl font-bold text-foreground">My Applications</div>
        <div className="text-sm text-muted-foreground">Track status and reviewer feedback</div>
      </div>

      {error ? <Card className="p-4 text-red-200 border border-red-500/30 bg-red-500/5">{error}</Card> : null}

      <div className="space-y-3">
        {apps.map((a) => (
          <Card key={a.id} className="p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">{a.application_number}</div>
                <div className="text-lg font-semibold text-foreground">{a.project_name ?? "Permit Application"}</div>
                <div className="text-sm text-muted-foreground">Site Class: {a.site_class ?? "N/A"}</div>
              </div>
              <PermitStatus status={a.status ?? "pending"} />
            </div>
            {a.reviewer_comments ? <div className="mt-3 text-sm text-muted-foreground">{a.reviewer_comments}</div> : null}
          </Card>
        ))}
        {apps.length === 0 && !error ? <Card className="p-6 text-sm text-muted-foreground">No applications yet.</Card> : null}
      </div>
    </div>
  )
}

