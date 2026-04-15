"use client"

import { Card } from "@/components/ui/card"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area } from "recharts"
import { TrendingUp, AlertCircle, CheckCircle2, Users } from "lucide-react"
import type { User } from "@/lib/auth-context"

interface DashboardOverviewProps {
  user: User | null
}

const seismicData = [
  { month: "Jan", magnitude: 4.2, depth: 12, activity: 65 },
  { month: "Feb", magnitude: 3.8, depth: 15, activity: 59 },
  { month: "Mar", magnitude: 5.1, depth: 8, activity: 80 },
  { month: "Apr", magnitude: 4.5, depth: 18, activity: 81 },
  { month: "May", magnitude: 3.9, depth: 10, activity: 56 },
  { month: "Jun", magnitude: 4.7, depth: 14, activity: 55 },
]

const projectStats = [
  { label: "Active Projects", value: "12", icon: TrendingUp, color: "accent" },
  { label: "Pending Approvals", value: "3", icon: AlertCircle, color: "accent" },
  { label: "Completed", value: "48", icon: CheckCircle2, color: "accent" },
  { label: "Team Members", value: "24", icon: Users, color: "accent" },
]

export function DashboardOverview({ user }: DashboardOverviewProps) {
  return (
    <div className="p-8 space-y-8 bg-background">
      <div className="animate-fade-in-up">
        <h2 className="text-5xl font-bold gradient-text mb-2">Welcome, {user?.name}</h2>
        <p className="text-muted-foreground font-semibold">
          {user?.organization} • <span className="text-accent font-bold uppercase tracking-widest">{user?.role}</span>
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {projectStats.map((stat, i) => {
          const Icon = stat.icon
          return (
            <Card
              key={stat.label}
              className="p-6 card-hover bg-card/60 border-accent/20 overflow-hidden relative group glow-border"
              style={{ animationDelay: `${i * 100}ms` }}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-accent/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
              <div className="relative z-10">
                <div className="flex items-center justify-between mb-4">
                  <p className="text-sm text-muted-foreground font-bold uppercase tracking-wide">{stat.label}</p>
                  <div className="p-2 rounded-lg bg-gradient-to-br from-accent/20 to-accent/5">
                    <Icon className="w-4 h-4 text-accent" />
                  </div>
                </div>
                <p className="text-4xl font-bold gradient-text">{stat.value}</p>
              </div>
            </Card>
          )
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="p-6 card-hover bg-card/60 border-accent/20 glow-border">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-foreground">Seismic Activity Trend</h3>
            <p className="text-sm text-accent font-bold uppercase tracking-widest">Last 6 months analysis</p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <AreaChart data={seismicData}>
              <defs>
                <linearGradient id="colorMagnitude" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="var(--accent)" stopOpacity={0.8} />
                  <stop offset="95%" stopColor="var(--accent)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.2} />
              <XAxis dataKey="month" stroke="var(--muted-foreground)" />
              <YAxis stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--accent)",
                  borderRadius: "8px",
                }}
              />
              <Area
                type="monotone"
                dataKey="magnitude"
                stroke="var(--accent)"
                fillOpacity={1}
                fill="url(#colorMagnitude)"
              />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card className="p-6 card-hover bg-card/60 border-accent/20 glow-border">
          <div className="mb-6">
            <h3 className="text-lg font-bold text-foreground">Depth Distribution</h3>
            <p className="text-sm text-accent font-bold uppercase tracking-widest">Geological depth analysis</p>
          </div>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={seismicData}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.2} />
              <XAxis dataKey="month" stroke="var(--muted-foreground)" />
              <YAxis stroke="var(--muted-foreground)" />
              <Tooltip
                contentStyle={{
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--accent)",
                  borderRadius: "8px",
                }}
              />
              <Bar dataKey="depth" fill="var(--accent)" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card className="p-6 card-hover bg-card/60 border-accent/20 glow-border">
        <div className="mb-6">
          <h3 className="text-lg font-bold text-foreground">Recent Activity</h3>
          <p className="text-sm text-accent font-bold uppercase tracking-widest">Team updates and notifications</p>
        </div>
        <div className="space-y-3">
          {[
            { action: "Project updated", time: "2 hours ago", user: "Sarah Chen", icon: "📊" },
            { action: "Data uploaded", time: "5 hours ago", user: "Mike Johnson", icon: "📁" },
            { action: "Report generated", time: "1 day ago", user: "You", icon: "📄" },
            { action: "Approval requested", time: "2 days ago", user: "Alex Rivera", icon: "✓" },
          ].map((activity, i) => (
            <div
              key={i}
              className="flex justify-between items-center py-3 px-4 rounded-lg hover:bg-accent/5 transition-all duration-200 group border border-transparent hover:border-accent/20"
            >
              <div className="flex items-center gap-3">
                <div className="text-xl">{activity.icon}</div>
                <div>
                  <p className="font-bold text-sm text-foreground group-hover:text-accent transition-colors">
                    {activity.action}
                  </p>
                  <p className="text-xs text-muted-foreground font-semibold">{activity.user}</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground font-semibold">{activity.time}</p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  )
}
