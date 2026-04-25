"use client"

import { Card } from "@/components/ui/card"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts"
import type { User } from "@/lib/auth-context"

interface SoilSeismicDataProps {
  user: User | null
}

const soilData = [
  { depth: "1m", density: 1.8, shearWave: 250 },
  { depth: "2m", density: 1.85, shearWave: 285 },
]

export function SoilSeismicData({ user }: SoilSeismicDataProps) {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Soil & Seismic Data</h2>
        <p className="text-muted-foreground">Geological and seismic parameters for site analysis</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-6">
          <p className="text-sm text-muted-foreground mb-2">Site Classification</p>
          <p className="text-2xl font-bold text-primary">Class D</p>
          <p className="text-xs text-muted-foreground mt-2">Stiff soil profile</p>
        </Card>
        <Card className="p-6">
          <p className="text-sm text-muted-foreground mb-2">Peak Ground Acceleration</p>
          <p className="text-2xl font-bold text-accent">0.45g</p>
          <p className="text-xs text-muted-foreground mt-2">500-year return period</p>
        </Card>
        <Card className="p-6">
          <p className="text-sm text-muted-foreground mb-2">Fundamental Period</p>
          <p className="text-2xl font-bold text-chart-3">1.2s</p>
          <p className="text-xs text-muted-foreground mt-2">Estimated from soil profile</p>
        </Card>
      </div>

      <Card className="p-6">
        <h3 className="text-lg font-semibold mb-4">Soil Profile - Shear Wave Velocity</h3>
        <ResponsiveContainer width="100%" height={300}>
          <BarChart data={soilData}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
            <XAxis dataKey="depth" stroke="var(--muted-foreground)" />
            <YAxis stroke="var(--muted-foreground)" />
            <Tooltip />
            <Legend />
            <Bar dataKey="shearWave" fill="var(--chart-1)" name="Shear Wave (m/s)" />
          </BarChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Bore Hole Data</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Hole ID</span>
              <span className="font-medium">BH-001</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Depth</span>
              <span className="font-medium">25.5 m</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Samples</span>
              <span className="font-medium">12</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium text-primary">Completed</span>
            </div>
          </div>
        </Card>

        <Card className="p-6">
          <h3 className="text-lg font-semibold mb-4">Seismic Parameters</h3>
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Magnitude</span>
              <span className="font-medium">6.5</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Distance</span>
              <span className="font-medium">45 km</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Depth</span>
              <span className="font-medium">12 km</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Mechanism</span>
              <span className="font-medium">Strike-slip</span>
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}
