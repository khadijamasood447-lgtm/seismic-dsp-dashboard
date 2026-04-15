"use client"

import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { CheckCircle, XCircle, Clock } from "lucide-react"
import type { User } from "@/lib/auth-context"

interface ApprovalsPanelProps {
  user: User | null
}

interface ApprovalRequest {
  id: string
  title: string
  description: string
  requestedBy: string
  status: "pending" | "approved" | "rejected"
  date: string
}

const approvals: ApprovalRequest[] = [
  {
    id: "1",
    title: "Seismic Analysis Report - Building A",
    description: "Final report for structural assessment",
    requestedBy: "Sarah Chen",
    status: "pending",
    date: "2 hours ago",
  },
  {
    id: "2",
    title: "Soil Profile Update",
    description: "New bore hole data from site investigation",
    requestedBy: "Mike Johnson",
    status: "approved",
    date: "1 day ago",
  },
  {
    id: "3",
    title: "Design Modification Request",
    description: "Foundation design changes for Building C",
    requestedBy: "Alex Rivera",
    status: "rejected",
    date: "3 days ago",
  },
]

export function ApprovalsPanel({ user }: ApprovalsPanelProps) {
  const getStatusIcon = (status: string) => {
    switch (status) {
      case "pending":
        return <Clock className="w-5 h-5 text-accent" />
      case "approved":
        return <CheckCircle className="w-5 h-5 text-chart-3" />
      case "rejected":
        return <XCircle className="w-5 h-5 text-destructive" />
      default:
        return null
    }
  }

  const getStatusBadge = (status: string) => {
    const badges = {
      pending: "bg-accent/10 text-accent",
      approved: "bg-chart-3/10 text-chart-3",
      rejected: "bg-destructive/10 text-destructive",
    }
    return badges[status as keyof typeof badges] || ""
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Approvals</h2>
        <p className="text-muted-foreground">Manage project approvals and review requests</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-6">
          <p className="text-sm text-muted-foreground mb-2">Pending</p>
          <p className="text-3xl font-bold text-accent">3</p>
        </Card>
        <Card className="p-6">
          <p className="text-sm text-muted-foreground mb-2">Approved</p>
          <p className="text-3xl font-bold text-chart-3">12</p>
        </Card>
        <Card className="p-6">
          <p className="text-sm text-muted-foreground mb-2">Rejected</p>
          <p className="text-3xl font-bold text-destructive">2</p>
        </Card>
      </div>

      <div className="space-y-4">
        {approvals.map((approval) => (
          <Card key={approval.id} className="p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  {getStatusIcon(approval.status)}
                  <h3 className="font-semibold text-foreground">{approval.title}</h3>
                </div>
                <p className="text-sm text-muted-foreground mb-2">{approval.description}</p>
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Requested by {approval.requestedBy}</span>
                  <span>{approval.date}</span>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <span className={`px-3 py-1 rounded-full text-xs font-medium ${getStatusBadge(approval.status)}`}>
                  {approval.status.charAt(0).toUpperCase() + approval.status.slice(1)}
                </span>
                {approval.status === "pending" && (
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline">
                      Reject
                    </Button>
                    <Button size="sm" className="bg-primary hover:bg-primary/90">
                      Approve
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
