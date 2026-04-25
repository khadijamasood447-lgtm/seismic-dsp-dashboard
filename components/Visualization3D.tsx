"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Layers } from "lucide-react"
import { Button } from "./ui/button"
import ChatbotWidget from "./ChatbotWidget"

type IfcViz = {
  ok: boolean
  model_url?: string
  file_name?: string | null
  storeys?: number
  element_counts?: { columns: number; beams: number; footings: number; walls: number } | null
  building?: { name?: string; height_m?: number | null } | null
  warnings?: string[]
}

type ComplianceResult = {
  findings?: Array<{ status: string; code_section?: string; recommendation?: string; message?: string }>
  summary?: { pass_count: number; warning_count: number; fail_count: number }
}

function readStoredIfc() {
  try {
    const raw = localStorage.getItem("seismic_ifc_model_url")
    if (!raw) return null
    const parsed = JSON.parse(raw)
    const url = typeof parsed?.url === "string" ? parsed.url : null
    const fileName = typeof parsed?.file_name === "string" ? parsed.file_name : null
    return url ? { url, file_name: fileName } : null
  } catch {
    return null
  }
}

export function Visualization3D({ initialComplianceResult = null as ComplianceResult | null }) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const threeRef = useRef<any>(null)
  const complianceRef = useRef<ComplianceResult | null>(initialComplianceResult)
  const [ifcViz, setIfcViz] = useState<IfcViz | null>(null)
  const [modelUrl, setModelUrl] = useState<string | null>(null)
  const [status, setStatus] = useState<string>("No IFC loaded yet. Upload an IFC in chat to visualize it here.")
  const [complianceResult, setComplianceResult] = useState<ComplianceResult | null>(initialComplianceResult)
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null)
  const [loadSimplified, setLoadSimplified] = useState<boolean>(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const toggleFullscreen = () => {
    if (!containerRef.current) return
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().catch(err => {
        console.error(`Error attempting to enable full-screen mode: ${err.message}`)
      })
    } else {
      document.exitFullscreen()
    }
  }

  useEffect(() => {
    const handleFsChange = () => {
      setIsFullscreen(!!document.fullscreenElement)
      setTimeout(() => {
        if (threeRef.current?.onResize) threeRef.current.onResize()
      }, 100)
    }
    document.addEventListener('fullscreenchange', handleFsChange)
    return () => document.removeEventListener('fullscreenchange', handleFsChange)
  }, [])

  const countsLabel = useMemo(() => {
    const c = ifcViz?.element_counts
    if (!c) return null
    return `Columns: ${c.columns} · Beams: ${c.beams} · Footings: ${c.footings} · Walls: ${c.walls}`
  }, [ifcViz])

  useEffect(() => {
    const stored = readStoredIfc()
    if (stored?.url) setModelUrl(stored.url)
    const onIfc = (ev: any) => {
      const d = (ev?.detail ?? null) as IfcViz | null
      if (!d) return
      setIfcViz(d)
      if (d?.model_url) setModelUrl(String(d.model_url))
    }
    window.addEventListener("seismic-ifc-model", onIfc as any)
    const onCompliance = (ev: any) => {
      const d = (ev?.detail ?? null) as ComplianceResult | null
      if (!d) return
      setComplianceResult(d)
    }
    window.addEventListener("seismic-compliance-result", onCompliance as any)
    return () => {
      window.removeEventListener("seismic-ifc-model", onIfc as any)
      window.removeEventListener("seismic-compliance-result", onCompliance as any)
    }
  }, [])

  useEffect(() => {
    complianceRef.current = complianceResult
  }, [complianceResult])

  useEffect(() => {
    if (!mountRef.current) return

    let cancelled = false
    let raf = 0

    const init = async () => {
      const THREE = await import("three")
      const { OrbitControls } = await import("three/examples/jsm/controls/OrbitControls.js")

      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x0b0b0c)

      const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 5000)
      camera.position.set(10, 12, 18)

      const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
      renderer.setPixelRatio(window.devicePixelRatio || 1)
      renderer.shadowMap.enabled = true

      const el = mountRef.current!
      while (el.firstChild) el.removeChild(el.firstChild)
      el.appendChild(renderer.domElement)

      const controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping = true
      controls.dampingFactor = 0.08

      const hemi = new THREE.HemisphereLight(0xffffff, 0x222233, 1.1)
      scene.add(hemi)
      const dir = new THREE.DirectionalLight(0xffffff, 1.0)
      dir.position.set(20, 30, 10)
      scene.add(dir)

      const grid = new THREE.GridHelper(80, 80, 0x334155, 0x1f2937)
      scene.add(grid)

      const onResize = () => {
        if (!mountRef.current) return
        const w = mountRef.current.clientWidth
        const h = mountRef.current.clientHeight
        if (!w || !h) return
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h, false)
      }
      onResize()
      window.addEventListener("resize", onResize)

      const raycaster = new THREE.Raycaster()
      const pointer = new THREE.Vector2()
      const onClick = (ev: MouseEvent) => {
        const host = mountRef.current
        const currentCompliance = complianceRef.current
        if (!host || !threeRef.current?.ifcModel || !currentCompliance?.findings?.length) return
        const rect = host.getBoundingClientRect()
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, camera)
        const intersects = raycaster.intersectObject(threeRef.current.ifcModel, true)
        if (!intersects.length) {
          setTooltip(null)
          return
        }
        const fail = currentCompliance.findings.find((f) => f.status === "fail")
        const warn = currentCompliance.findings.find((f) => f.status === "warning")
        const item = fail ?? warn ?? currentCompliance.findings[0]
        setTooltip({
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
          text: `${String(item?.status ?? "info").toUpperCase()} · ${item?.code_section ?? "BCP-SP 2021"}\n${item?.recommendation ?? item?.message ?? ""}`,
        })
      }
      renderer.domElement.addEventListener("click", onClick)

      const tick = () => {
        if (cancelled) return
        controls.update()
        renderer.render(scene, camera)
        raf = requestAnimationFrame(tick)
      }
      tick()

      threeRef.current = {
        THREE,
        scene,
        camera,
        renderer,
        controls,
        grid,
        onResize,
        onClick,
        ifcModel: null as any,
      }
    }

    init()

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      const t = threeRef.current
      if (t?.renderer) {
        try {
          window.removeEventListener("resize", t.onResize)
        } catch {}
        try {
          t.renderer.domElement?.removeEventListener("click", t.onClick)
        } catch {}
        try {
          t.renderer.dispose()
        } catch {}
      }
      threeRef.current = null
    }
  }, [])

  useEffect(() => {
    const loadModel = async () => {
      if (!modelUrl) return
      const t = threeRef.current
      if (!t?.scene || !t?.THREE) return

      setStatus(loadSimplified ? "Loading simplified model (first floor)…" : "Loading IFC model…")

      try {
        const wasmRes = await fetch("/wasm/web-ifc.wasm", { method: "GET" })
        const ct = (wasmRes.headers.get("content-type") || "").toLowerCase()
        if (!wasmRes.ok || ct.includes("text/html")) {
          setStatus(
            `web-ifc wasm is not being served correctly from /wasm/web-ifc.wasm (status ${wasmRes.status}, content-type ${ct || "unknown"}). Ensure public/wasm/web-ifc.wasm exists and restart the dev server.`,
          )
          return
        }
      } catch {
        setStatus("Unable to verify /wasm/web-ifc.wasm. Ensure it exists under public/wasm/ and try again.")
        return
      }

      const { IFCLoader } = await import("three/examples/jsm/loaders/IFCLoader.js")

      const loader = new IFCLoader()
      loader.ifcManager.setWasmPath("/wasm/")

      if (loadSimplified) {
        loader.ifcManager.listener = () => {
          // Will be populated with filtering logic
        }
      }

      if (t.ifcModel) {
        t.scene.remove(t.ifcModel)
        t.ifcModel = null
      }

      loader.load(
        modelUrl,
        (ifcModel: any) => {
          if (loadSimplified && ifcViz?.storeys && ifcViz.storeys > 1) {
            ifcModel.traverse((child: any) => {
              if (child.userData?.storeyIndex !== undefined && child.userData.storeyIndex > 0) {
                child.visible = false
              }
            })
            setStatus(`Simplified view: Showing first storey only (${ifcViz.storeys} total storeys).`)
          }
          
          t.ifcModel = ifcModel
          t.scene.add(ifcModel)

          const box = new t.THREE.Box3().setFromObject(ifcModel)
          const size = box.getSize(new t.THREE.Vector3())
          const center = box.getCenter(new t.THREE.Vector3())

          const maxDim = Math.max(size.x, size.y, size.z) || 10
          const dist = maxDim * 1.6
          t.controls.target.set(center.x, center.y, center.z)
          t.camera.position.set(center.x + dist, center.y + dist * 0.6, center.z + dist)
          t.camera.near = Math.max(0.01, maxDim / 2000)
          t.camera.far = Math.max(5000, maxDim * 50)
          t.camera.updateProjectionMatrix()
          t.controls.update()

          setStatus("IFC loaded. Use mouse/touch to orbit, pan, and zoom.")
        },
        undefined,
        () => {
          setStatus("Failed to load IFC model. Confirm /wasm/web-ifc.wasm is reachable and the IFC URL is accessible.")
        },
      )
    }

    loadModel()
  }, [modelUrl, loadSimplified, ifcViz])

  useEffect(() => {
    const t = threeRef.current
    if (!t?.ifcModel || !t?.THREE) return
    const hasFail = (complianceResult?.summary?.fail_count ?? 0) > 0
    const hasWarn = (complianceResult?.summary?.warning_count ?? 0) > 0
    const color = hasFail ? new t.THREE.Color(0xd9463f) : hasWarn ? new t.THREE.Color(0xeab308) : new t.THREE.Color(0x9ca3af)
    t.ifcModel.traverse((obj: any) => {
      if (!obj?.isMesh || !obj?.material) return
      const mat = obj.material
      if (Array.isArray(mat)) {
        for (const m of mat) {
          if (m?.color) m.color.copy(color)
          if (typeof m?.opacity === "number") m.opacity = 0.95
          m.needsUpdate = true
        }
      } else {
        if (mat?.color) mat.color.copy(color)
        if (typeof mat?.opacity === "number") mat.opacity = 0.95
        mat.needsUpdate = true
      }
    })
  }, [complianceResult, modelUrl])

  return (
    <div className="min-h-screen bg-background text-foreground">
      <ChatbotWidget />
      <div className="w-full px-4 sm:px-6 lg:px-8 py-4">
        <div className="mb-4 flex justify-between items-end">
          <div>
            <h1 className="text-xl sm:text-2xl font-semibold tracking-tight text-foreground">3D Visualizer</h1>
            <p className="text-xs sm:text-sm text-muted-foreground">Visualize uploaded IFC models and compliance findings</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-9">
            <div ref={containerRef} className={`bg-card border border-border rounded-lg overflow-hidden relative ${isFullscreen ? 'h-screen w-screen fixed inset-0 z-[100]' : 'h-[75vh] min-h-[500px]'}`}>
              <div ref={mountRef} className="absolute inset-0" />
              
              <div className="absolute left-3 top-3 rounded-md border border-gray-300 bg-white/90 px-3 py-2 text-[11px] text-gray-900 backdrop-blur shadow-sm z-10">
                <div className="font-semibold">{ifcViz?.file_name ?? "IFC viewer"}</div>
                <div className="text-gray-700">{status}</div>
                {ifcViz?.storeys != null ? <div className="text-gray-700">Storeys: {ifcViz.storeys}</div> : null}
                {countsLabel ? <div className="text-gray-700">{countsLabel}</div> : null}
              </div>

              <div className="absolute right-3 top-3 flex gap-2 z-10">
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-white/80 backdrop-blur-sm border border-gray-300 text-gray-900 h-8 px-2"
                  onClick={() => {
                    const t = threeRef.current
                    if (!t?.controls) return
                    t.controls.reset()
                  }}
                >
                  Reset View
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-white/80 backdrop-blur-sm border border-gray-300 text-gray-900 h-8 px-2"
                  onClick={toggleFullscreen}
                >
                  {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
                </Button>
              </div>

              {tooltip ? (
                <div
                  className="absolute z-20 max-w-[320px] rounded-md border border-gray-300 bg-white/90 px-3 py-2 text-xs text-gray-900 whitespace-pre-wrap shadow-lg"
                  style={{ left: Math.min(tooltip.x + 8, 300), top: Math.max(tooltip.y - 10, 12) }}
                >
                  {tooltip.text}
                </div>
              ) : null}
            </div>
          </div>

          <div className="lg:col-span-3 space-y-4">
            <div className="bg-card border border-border rounded-lg p-4">
              <div className="flex items-center gap-2 mb-2">
                <Layers className="w-5 h-5 text-[#0d9488]" />
                <h3 className="font-semibold text-foreground">Model Summary</h3>
              </div>
              <div className="space-y-2 text-sm">
                <div className="text-muted-foreground">File</div>
                <div className="text-foreground break-words">{ifcViz?.file_name ?? "—"}</div>
                <div className="text-muted-foreground mt-2">Building</div>
                <div className="text-foreground break-words">{ifcViz?.building?.name ?? "—"}</div>
                <div className="text-muted-foreground mt-2">Height (screening)</div>
                <div className="text-foreground">
                  {typeof ifcViz?.building?.height_m === "number" ? `${ifcViz!.building!.height_m!.toFixed(1)} m` : "—"}
                </div>
                <div className="text-muted-foreground mt-2">Elements</div>
                <div className="text-foreground">{countsLabel ?? "—"}</div>
                {complianceResult?.summary ? (
                  <>
                    <div className="text-muted-foreground mt-2">Compliance Summary</div>
                    <div className="text-foreground">
                      Pass: {complianceResult.summary.pass_count} · Warning: {complianceResult.summary.warning_count} · Fail: {complianceResult.summary.fail_count}
                    </div>
                  </>
                ) : null}
                {ifcViz?.warnings?.length ? (
                  <div className="mt-3 text-xs text-amber-200 space-y-2">
                    {ifcViz.warnings.slice(0, 3).map((w, i) => (
                      <div key={i}>{w}</div>
                    ))}
                    {ifcViz.warnings.some(w => w.includes('MB')) && !loadSimplified && (
                      <button
                        onClick={() => setLoadSimplified(true)}
                        className="mt-3 px-3 py-1.5 bg-amber-900 hover:bg-amber-800 rounded text-amber-100 text-xs font-semibold transition-colors"
                      >
                        Load Simplified (First Floor Only)
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="bg-card border border-border rounded-lg p-4">
              <h3 className="text-sm uppercase tracking-wider text-[#0d9488] mb-2">Next Step</h3>
              <div className="text-xs text-muted-foreground">
                Ask in chat: "Analyze this model against BCP-SP 2021" to run screening checks at the building location.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}