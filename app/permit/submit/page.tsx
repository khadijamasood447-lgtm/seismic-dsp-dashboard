"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"

export default function SubmitPermitPage() {
  const [projectName, setProjectName] = useState("")
  const [lat, setLat] = useState("")
  const [lon, setLon] = useState("")
  const [notes, setNotes] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [status, setStatus] = useState<string>("")
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    if (!file) return
    setBusy(true)
    setStatus("")
    try {
      const fd = new FormData()
      fd.append("project_name", projectName)
      fd.append("lat", lat)
      fd.append("lon", lon)
      fd.append("engineer_notes", notes)
      fd.append("ifc_file", file)
      const res = await fetch("/api/permit/submit", { method: "POST", body: fd })
      const json = await res.json().catch(() => null)
      if (!json?.ok) {
        setStatus(`Error: ${json?.error ?? "submit failed"}`)
        return
      }
      setStatus(`Submitted: ${json?.application?.application_number ?? json?.application?.id ?? ""}`)
    } catch {
      setStatus("Error: submit failed")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="p-8 space-y-4">
      <div>
        <div className="text-2xl font-bold text-foreground">Submit Permit</div>
        <div className="text-sm text-muted-foreground">Upload IFC and submit for compliance review</div>
      </div>

      <Card className="p-6 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-2">
            <div className="text-sm font-medium">Project name</div>
            <Input value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="G-6 Commercial Building" />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">IFC file</div>
            <Input type="file" accept=".ifc" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">Latitude</div>
            <Input value={lat} onChange={(e) => setLat(e.target.value)} placeholder="33.715566" />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">Longitude</div>
            <Input value={lon} onChange={(e) => setLon(e.target.value)} placeholder="73.088120" />
          </div>
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Engineer notes</div>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="5-story commercial building, reinforced concrete" />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="text-xs text-muted-foreground">
            PRELIMINARY ASSESSMENT - NOT FOR CONSTRUCTION. Verify with licensed engineer and site investigation.
          </div>
          <Button onClick={submit} disabled={busy || !file}>
            {busy ? "Submitting..." : "Submit"}
          </Button>
        </div>

        {status ? <div className="text-sm text-foreground">{status}</div> : null}
      </Card>
    </div>
  )
}

