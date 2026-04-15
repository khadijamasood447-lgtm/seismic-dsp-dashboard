"use client"

import { useEffect, useState } from "react"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import PermitStatus from "@/components/permit/PermitStatus"
import ReviewModal from "@/components/permit/ReviewModal"

export default function ReviewApplicationPage({ params }: { params: { id: string } }) {
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState("")
  const [open, setOpen] = useState(false)

  const load = async () => {
    try {
      const res = await fetch(`/api/permit/applications/${params.id}`)
      const json = await res.json().catch(() => null)
      if (!json?.ok) {
        setError(String(json?.error ?? "failed"))
        return
      }
      setData(json)
    } catch {
      setError("failed")
    }
  }

  useEffect(() => {
    load()
  }, [])

  const submit = async (payload: { decision: "approved" | "rejected" | "needs_revision"; comments: string }) => {
    const res = await fetch(`/api/permit/applications/${params.id}/review`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    })
    const json = await res.json().catch(() => null)
    if (!json?.ok) throw new Error(String(json?.error ?? "review failed"))
    await load()
  }

  if (error) {
    return <div className="p-8">{error}</div>
  }

  const app = data?.application ?? null
  const reviews = Array.isArray(data?.reviews) ? data.reviews : []

  return (
    <div className="p-8 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <div className="text-2xl font-bold text-foreground">Review Application</div>
          <div className="text-sm text-muted-foreground">{app?.application_number ?? params.id}</div>
        </div>
        {app ? <PermitStatus status={app.status ?? "pending"} /> : null}
      </div>

      <Card className="p-6 space-y-2">
        <div className="text-lg font-semibold text-foreground">{app?.project_name ?? "Permit Application"}</div>
        <div className="text-sm text-muted-foreground">Site Class: {app?.site_class ?? "N/A"}</div>
        <div className="text-sm text-muted-foreground">IFC: {app?.ifc_file_url ? <a className="text-primary hover:underline" href={app.ifc_file_url}>Download</a> : "N/A"}</div>
        <div className="pt-3">
          <Button onClick={() => setOpen(true)}>Submit Decision</Button>
        </div>
      </Card>

      <Card className="p-6">
        <div className="text-sm font-semibold text-foreground mb-2">Review History</div>
        <div className="space-y-2">
          {reviews.map((r: any) => (
            <div key={r.id} className="text-sm text-muted-foreground">
              {new Date(r.reviewed_at).toLocaleString()} — {r.decision}: {r.comments || ""}
            </div>
          ))}
          {reviews.length === 0 ? <div className="text-sm text-muted-foreground">No reviews yet.</div> : null}
        </div>
      </Card>

      <ReviewModal open={open} onClose={() => setOpen(false)} onSubmit={submit} />
    </div>
  )
}

