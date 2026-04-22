"use client"

import { useRef, useState } from "react"
import { Card } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Upload, File, Trash2, FilePlus } from "lucide-react"
import type { User } from "@/lib/auth-context"
import { ReportUpload } from "@/components/ReportUpload"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"

interface UploadCenterProps {
  user: User | null
}

interface UploadedFile {
  id: string
  name: string
  size: string
  type: string
  uploadedBy: string
  date: string
}

const uploadedFiles: UploadedFile[] = [
  {
    id: "1",
    name: "Seismic_Data_2024.csv",
    size: "2.4 MB",
    type: "CSV",
    uploadedBy: "You",
    date: "2 hours ago",
  },
  {
    id: "2",
    name: "Building_Model.ifc",
    size: "15.8 MB",
    type: "IFC",
    uploadedBy: "Sarah Chen",
    date: "1 day ago",
  },
  {
    id: "3",
    name: "Soil_Profile_Analysis.pdf",
    size: "3.2 MB",
    type: "PDF",
    uploadedBy: "Mike Johnson",
    date: "3 days ago",
  },
]

export function UploadCenter({ user }: UploadCenterProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [analysis, setAnalysis] = useState<any>(null)
  const [error, setError] = useState<string>("")
  const inputRef = useRef<HTMLInputElement | null>(null)

  const analyzeIfc = async (file: File) => {
    setError("")
    setAnalysis(null)
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const res = await fetch("/api/analyze-ifc", { method: "POST", body: fd })
      const json = await res.json().catch(() => null)
      if (!json?.ok) {
        setError(String(json?.error ?? "IFC analysis failed"))
        return
      }
      setAnalysis(json)
    } catch {
      setError("IFC analysis failed")
    } finally {
      setUploading(false)
    }
  }

  const generateReport = async () => {
    if (!analysis?.site_conditions?.location) return
    try {
      const res = await fetch("/api/generate-report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          location: analysis.site_conditions.location,
          pga_scenario: 0.3,
          building_type: "N/A",
          ifc_analysis: analysis,
        }),
      })
      if (!res.ok) {
        setError("Report generation failed")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `report_${analysis.analysis_id ?? "ifc"}.pdf`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    } catch {
      setError("Report generation failed")
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-foreground">Upload Center</h2>
        <p className="text-muted-foreground">Manage project files and data uploads</p>
      </div>

      <Tabs defaultValue="ifc" className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="ifc">IFC Analysis</TabsTrigger>
          <TabsTrigger value="compliance">Compliance Reports</TabsTrigger>
        </TabsList>
        
        <TabsContent value="ifc" className="space-y-6">
          {/* Upload Area */}
          <Card
            className={`p-12 border-2 border-dashed transition-colors ${
              isDragging ? "border-primary bg-primary/5" : "border-border"
            }`}
            onDragOver={(e) => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault()
              setIsDragging(false)
              const f = e.dataTransfer.files?.[0]
              if (f) analyzeIfc(f)
            }}
          >
            <div className="flex flex-col items-center justify-center text-center">
              <div className="w-16 h-16 bg-primary/10 rounded-lg flex items-center justify-center mb-4">
                <Upload className="w-8 h-8 text-primary" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Drag files here or click to browse</h3>
              <p className="text-muted-foreground mb-4 max-w-md">
                Upload an IFC file to run a preliminary code screening report (BCP-SP 2021)
              </p>
              <input
                ref={inputRef}
                type="file"
                accept=".ifc"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0]
                  if (f) analyzeIfc(f)
                  e.currentTarget.value = ""
                }}
              />
              <Button className="bg-primary hover:bg-primary/90" onClick={() => inputRef.current?.click()} disabled={uploading}>
                {uploading ? "Analyzing..." : "Select IFC"}
              </Button>
            </div>
          </Card>

          {error ? (
            <Card className="p-4 border border-red-500/30 bg-red-500/5 text-red-200">
              <div className="font-medium">Error</div>
              <div className="text-sm">{error}</div>
            </Card>
          ) : null}

          {analysis ? (
            <Card className="p-5 space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-lg font-semibold text-foreground">IFC Screening Results</div>
                  <div className="text-xs text-muted-foreground">{analysis.disclaimer}</div>
                </div>
                <Button className="bg-primary hover:bg-primary/90" onClick={generateReport}>
                  Generate Full Report
                </Button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Card className="p-4">
                  <div className="text-sm font-semibold mb-2">Building</div>
                  <div className="text-sm text-muted-foreground">
                    Name: {analysis.building_info?.name ?? "N/A"} | Height:{" "}
                    {analysis.building_info?.height_m != null ? `${Number(analysis.building_info.height_m).toFixed(1)} m` : "N/A"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Elements: columns {analysis.building_info?.element_counts?.columns ?? 0}, beams{" "}
                    {analysis.building_info?.element_counts?.beams ?? 0}, footings {analysis.building_info?.element_counts?.footings ?? 0}
                  </div>
                </Card>
                <Card className="p-4">
                  <div className="text-sm font-semibold mb-2">Site Conditions</div>
                  <div className="text-sm text-muted-foreground">
                    Site Class (proxy): {analysis.site_conditions?.site_class ?? "N/A"} | Vs30:{" "}
                    {analysis.site_conditions?.vs30_m_s != null ? `${Number(analysis.site_conditions.vs30_m_s).toFixed(0)} m/s` : "N/A"}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Location: lat {Number(analysis.site_conditions?.location?.lat).toFixed(5)}, lon{" "}
                    {Number(analysis.site_conditions?.location?.lon).toFixed(5)}
                  </div>
                </Card>
              </div>
              <Card className="p-4">
                <div className="text-sm font-semibold mb-2">Findings</div>
                <div className="space-y-2">
                  {(analysis.inconsistencies ?? []).map((x: any, i: number) => (
                    <div key={i} className="text-sm text-muted-foreground">
                      <span className="font-semibold text-foreground">{String(x.severity ?? "").toUpperCase()}</span>: {x.description}
                    </div>
                  ))}
                </div>
              </Card>
            </Card>
          ) : null}
        </TabsContent>

        <TabsContent value="compliance">
          <ReportUpload />
        </TabsContent>
      </Tabs>

      {/* File List */}
      <div>
        <h3 className="text-lg font-semibold mb-4">Recent Uploads</h3>
        <div className="space-y-3">
          {uploadedFiles.map((file) => (
            <Card key={file.id} className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-4 flex-1">
                <div className="w-10 h-10 bg-primary/10 rounded flex items-center justify-center">
                  <File className="w-5 h-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium text-foreground">{file.name}</p>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span>{file.size}</span>
                    <span>{file.type}</span>
                    <span>by {file.uploadedBy}</span>
                    <span>{file.date}</span>
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive">
                <Trash2 className="w-4 h-4" />
              </Button>
            </Card>
          ))}
        </div>
      </div>
    </div>
  )
}
