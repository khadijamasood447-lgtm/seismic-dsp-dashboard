"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

type Props = {
  open: boolean
  onClose: () => void
  onSubmit: (payload: { decision: "approved" | "rejected" | "needs_revision"; comments: string }) => Promise<void>
}

export default function ReviewModal({ open, onClose, onSubmit }: Props) {
  const [decision, setDecision] = useState<"approved" | "rejected" | "needs_revision">("approved")
  const [comments, setComments] = useState("")
  const [busy, setBusy] = useState(false)

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 px-4">
      <div className="w-full max-w-[560px] rounded-lg border border-slate-800 bg-slate-950 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="text-lg font-semibold text-white">Submit Review</div>
          <button onClick={onClose} className="h-8 w-8 rounded-md hover:bg-slate-900 text-white">
            ×
          </button>
        </div>

        <div className="mt-3 flex gap-2">
          <Button variant={decision === "approved" ? "default" : "outline"} onClick={() => setDecision("approved")}>
            Approve
          </Button>
          <Button variant={decision === "rejected" ? "default" : "outline"} onClick={() => setDecision("rejected")}>
            Reject
          </Button>
          <Button
            variant={decision === "needs_revision" ? "default" : "outline"}
            onClick={() => setDecision("needs_revision")}
          >
            Needs Revision
          </Button>
        </div>

        <div className="mt-3">
          <Textarea value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Reviewer comments" className="min-h-[140px]" />
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            onClick={async () => {
              setBusy(true)
              try {
                await onSubmit({ decision, comments })
                onClose()
              } finally {
                setBusy(false)
              }
            }}
            disabled={busy}
          >
            {busy ? "Submitting..." : "Submit"}
          </Button>
        </div>
      </div>
    </div>
  )
}

