"use client"

type Props = { status: string }

export default function PermitStatus({ status }: Props) {
  const s = (status || "").toLowerCase()
  const color =
    s === "approved"
      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/30"
      : s === "rejected"
        ? "bg-red-500/10 text-red-300 border-red-500/30"
        : s === "needs_revision"
          ? "bg-amber-500/10 text-amber-300 border-amber-500/30"
          : s === "under_review"
            ? "bg-sky-500/10 text-sky-300 border-sky-500/30"
            : "bg-slate-500/10 text-slate-300 border-slate-500/30"
  return <span className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${color}`}>{status}</span>
}

