"use client"

import { useState } from "react"
import { Button } from "./ui/button"
import { Input } from "./ui/input"
import { Label } from "./ui/label"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card"
import { useToast } from "./ui/use-toast"
import { Spinner } from "./ui/spinner"

export function ReportUpload() {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [buildingType, setBuildingType] = useState("")
  const [location, setLocation] = useState("")
  const [isUploading, setIsUploading] = useState(false)
  const { toast } = useToast()

  const handleUpload = async () => {
    if (!file || !title) {
      toast({
        title: "Error",
        description: "Please provide a title and select a file.",
        variant: "destructive",
      })
      return
    }

    setIsUploading(true)
    try {
      const formData = new FormData()
      formData.append("file", file)
      formData.append("title", title)
      formData.append("buildingType", buildingType)
      formData.append("location", location)

      const res = await fetch("/api/reports/upload", {
        method: "POST",
        body: formData,
      })

      const json = await res.json()
      if (!res.ok) throw new Error(json.error || "Upload failed")

      toast({
        title: "Success",
        description: "Report uploaded successfully for review.",
      })

      // Reset form
      setFile(null)
      setTitle("")
      setBuildingType("")
      setLocation("")
    } catch (error: any) {
      toast({
        title: "Upload Failed",
        description: error.message,
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
    }
  }

  return (
    <Card className="w-full max-w-2xl mx-auto">
      <CardHeader>
        <CardTitle>Upload Compliance Report</CardTitle>
        <CardDescription>
          Submit your structural or geotechnical reports for CDA approval. Supported formats: PDF, DOCX, XLSX.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="title">Report Title</Label>
          <Input 
            id="title" 
            placeholder="e.g. Soil Investigation Report - Block G-6" 
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="buildingType">Building Type</Label>
            <Input 
              id="buildingType" 
              placeholder="e.g. Residential (R-1)" 
              value={buildingType}
              onChange={(e) => setBuildingType(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="location">Site Location</Label>
            <Input 
              id="location" 
              placeholder="e.g. Plot 12, Street 5, G-6/2" 
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="file">Report File</Label>
          <Input 
            id="file" 
            type="file" 
            accept=".pdf,.docx,.xlsx" 
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
        </div>
      </CardContent>
      <CardFooter>
        <Button 
          className="w-full bg-[#0d9488] hover:bg-[#0f766e]" 
          onClick={handleUpload}
          disabled={isUploading}
        >
          {isUploading ? <><Spinner className="mr-2 h-4 w-4" /> Uploading...</> : "Submit Report"}
        </Button>
      </CardFooter>
    </Card>
  )
}
