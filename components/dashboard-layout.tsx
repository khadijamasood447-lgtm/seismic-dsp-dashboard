"use client"

import { useState } from "react"
import { useAuth } from "@/lib/auth-context"
import { Navbar } from "./navbar"
import { Sidebar } from "./sidebar"
import { DashboardOverview } from "./sections/dashboard-overview"
import { ThreeDViewer } from "./sections/three-d-viewer"
import { SoilSeismicData } from "./sections/soil-seismic-data"
import { GeoLLMAssistant } from "./sections/geo-llm-assistant"
import { ApprovalsPanel } from "./sections/approvals-panel"
import { UploadCenter } from "./sections/upload-center"
import { ReportsSection } from "./sections/reports-section"

type Section = "overview" | "3d-viewer" | "soil-seismic" | "geo-llm" | "approvals" | "upload" | "reports"

export function DashboardLayout() {
  const { user, isAuthenticated } = useAuth()
  const [activeSection, setActiveSection] = useState<Section>("overview")
  const [sidebarOpen, setSidebarOpen] = useState(true)

  if (!isAuthenticated) {
    return null
  }

  const renderSection = () => {
    switch (activeSection) {
      case "overview":
        return <DashboardOverview user={user} />
      case "3d-viewer":
        return <ThreeDViewer user={user} />
      case "soil-seismic":
        return <SoilSeismicData user={user} />
      case "geo-llm":
        return <GeoLLMAssistant user={user} />
      case "approvals":
        return <ApprovalsPanel user={user} />
      case "upload":
        return <UploadCenter user={user} />
      case "reports":
        return <ReportsSection user={user} />
      default:
        return <DashboardOverview user={user} />
    }
  }

  return (
    <div className="flex h-screen bg-background">
      <Sidebar activeSection={activeSection} onSectionChange={setActiveSection} isOpen={sidebarOpen} />
      <div className="flex-1 flex flex-col overflow-hidden">
        <Navbar user={user} onToggleSidebar={() => setSidebarOpen(!sidebarOpen)} />
        <main className="flex-1 overflow-auto">{renderSection()}</main>
      </div>
    </div>
  )
}
