"use client"

import { Card } from "@/components/ui/card"
import type { User } from "@/lib/auth-context"

interface ThreeDViewerProps {
  user: User | null
}

export function ThreeDViewer({ user }: ThreeDViewerProps) {
  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">3D Viewer</h2>
        <p className="text-muted-foreground">Interactive 3D visualization of seismic data and building models</p>
      </div>

      <Card className="p-6 bg-muted/30 border-2 border-dashed border-border">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <div className="w-16 h-16 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m2-1l-2-1m2 1v2.5M14 4l-2 1m2-1l-2-1m2 1v2.5"
              />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">3D Model Loading</h3>
          <p className="text-muted-foreground max-w-md">
            Three.js 3D viewer will render here with building models, seismic data visualization, and interactive
            controls
          </p>
        </div>
      </Card>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4">
          <p className="text-sm text-muted-foreground mb-2">Model Type</p>
          <p className="font-semibold">BIM Structure</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground mb-2">Data Points</p>
          <p className="font-semibold">15,234</p>
        </Card>
        <Card className="p-4">
          <p className="text-sm text-muted-foreground mb-2">Last Updated</p>
          <p className="font-semibold">2 hours ago</p>
        </Card>
      </div>
    </div>
  )
}
