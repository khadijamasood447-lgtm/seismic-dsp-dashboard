"use client"

import { Button } from "@/components/ui/button"
import {
  LayoutDashboard,
  Cable as Cube,
  Database,
  MessageSquare,
  CheckCircle,
  Upload,
  FileText,
  ChevronRight,
  Zap,
} from "lucide-react"

interface SidebarProps {
  activeSection: string
  onSectionChange: (section: any) => void
  isOpen: boolean
}

const sections = [
  { id: "overview", label: "Dashboard", icon: LayoutDashboard },
  { id: "3d-viewer", label: "3D Viewer", icon: Cube },
  { id: "soil-seismic", label: "Soil & Seismic", icon: Database },
  { id: "geo-llm", label: "Geo-LLM Assistant", icon: MessageSquare },
  { id: "approvals", label: "Approvals", icon: CheckCircle },
  { id: "upload", label: "Upload Center", icon: Upload },
  { id: "reports", label: "Reports", icon: FileText },
]

export function Sidebar({ activeSection, onSectionChange, isOpen }: SidebarProps) {
  return (
    <aside
      className={`${
        isOpen ? "w-64" : "w-0"
      } bg-sidebar border-r border-accent/10 transition-all duration-300 overflow-hidden flex flex-col shadow-xl shadow-accent/5`}
    >
      <div className="p-6 border-b border-accent/10">
        <div className="flex items-center gap-2 mb-1">
          <Zap className="w-4 h-4 text-accent" />
          <h2 className="text-xs font-bold text-sidebar-foreground uppercase tracking-widest">Navigation</h2>
        </div>
        <p className="text-xs text-sidebar-foreground/60 font-bold">v1.0.0</p>
      </div>

      <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
        {sections.map((section) => {
          const Icon = section.icon
          const isActive = activeSection === section.id

          return (
            <Button
              key={section.id}
              variant={isActive ? "default" : "ghost"}
              className={`w-full justify-between gap-3 px-4 py-2.5 rounded-lg transition-all duration-200 ${
                isActive
                  ? "bg-gradient-to-r from-accent to-accent/80 text-accent-foreground shadow-lg shadow-accent/30 font-bold"
                  : "text-sidebar-foreground hover:bg-accent/10 hover:text-accent"
              }`}
              onClick={() => onSectionChange(section.id)}
            >
              <div className="flex items-center gap-3">
                <Icon className="w-4 h-4" />
                <span className="text-sm font-semibold">{section.label}</span>
              </div>
              {isActive && <ChevronRight className="w-4 h-4 animate-slide-in-right" />}
            </Button>
          )
        })}
      </nav>

      <div className="p-4 border-t border-accent/10">
        <p className="text-xs text-sidebar-foreground/60 font-bold">SeismicDSP v1.0.0</p>
        <p className="text-xs text-accent font-bold uppercase tracking-widest">Professional Edition</p>
      </div>
    </aside>
  )
}
