"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Layers } from "lucide-react"
import { Button } from "./ui/button"
import ChatbotWidget from "./ChatbotWidget"
import { IfcParser, extractEntityAttributesOnDemand, extractPropertiesOnDemand, type IfcDataStore } from "@ifc-lite/parser"
import { GeometryProcessor, type MeshData } from "@ifc-lite/geometry"

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
  const ifcRuntimeRef = useRef<{
    parser: IfcParser
    geometry: GeometryProcessor
    ready: boolean
    store: IfcDataStore | null
  } | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const selectedMeshRef = useRef<any>(null)
  const [ifcViz, setIfcViz] = useState<IfcViz | null>(null)
  const [modelUrl, setModelUrl] = useState<string | null>(null)
  const [localFile, setLocalFile] = useState<File | null>(null)
  const [modelFileName, setModelFileName] = useState<string | null>(null)
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
    if (stored?.file_name) setModelFileName(stored.file_name)
    const onIfc = (ev: any) => {
      const d = (ev?.detail ?? null) as IfcViz | null
      if (!d) return
      setIfcViz(d)
      if (d?.model_url) {
        setLocalFile(null)
        setModelUrl(String(d.model_url))
        setModelFileName(d?.file_name ?? null)
      }
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
        if (!host || !threeRef.current?.ifcGroup) return
        const rect = host.getBoundingClientRect()
        pointer.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1
        pointer.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1
        raycaster.setFromCamera(pointer, camera)
        const intersects = raycaster.intersectObject(threeRef.current.ifcGroup, true)
        if (!intersects.length) {
          setTooltip(null)
          if (selectedMeshRef.current?.material?.emissive) {
            try {
              selectedMeshRef.current.material.emissive.setHex(0x000000)
            } catch {}
          }
          selectedMeshRef.current = null
          return
        }

        let obj: any = intersects[0]?.object
        while (obj && obj.parent && !obj.userData?.expressId) obj = obj.parent
        const expressId = typeof obj?.userData?.expressId === "number" ? obj.userData.expressId : null
        const ifcType = typeof obj?.userData?.ifcType === "string" ? obj.userData.ifcType : null

        if (selectedMeshRef.current?.material?.emissive) {
          try {
            selectedMeshRef.current.material.emissive.setHex(0x000000)
          } catch {}
        }
        selectedMeshRef.current = obj
        if (obj?.material?.emissive) {
          try {
            obj.material.emissive.setHex(0x1d4ed8)
          } catch {}
        }

        const store = ifcRuntimeRef.current?.store ?? null
        const attrs = store && expressId != null ? extractEntityAttributesOnDemand(store, expressId) : null
        const psets = store && expressId != null ? extractPropertiesOnDemand(store, expressId) : []
        const keyProps: string[] = []
        for (const ps of psets.slice(0, 3)) {
          for (const p of (ps?.properties ?? []).slice(0, 6)) {
            const pv: any = (p as any)?.value
            const txt =
              typeof pv === "string"
                ? pv
                : typeof pv === "number"
                  ? String(pv)
                  : typeof pv?.value === "string" || typeof pv?.value === "number"
                    ? String(pv.value)
                    : null
            if (txt) keyProps.push(`${String((p as any)?.name ?? "")}=${txt}`)
            if (keyProps.length >= 6) break
          }
          if (keyProps.length >= 6) break
        }

        setTooltip({
          x: ev.clientX - rect.left,
          y: ev.clientY - rect.top,
          text:
            expressId != null
              ? `${ifcType ?? "IFC"} #${expressId}\n${attrs?.name ? `Name: ${attrs.name}\n` : ""}${attrs?.globalId ? `GlobalId: ${attrs.globalId}\n` : ""}${keyProps.length ? `Props: ${keyProps.join(" · ")}` : ""}`
              : "Selection unavailable",
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
        ifcGroup: null as any,
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
    const disposeGroup = (group: any) => {
      group?.traverse?.((obj: any) => {
        if (obj?.geometry?.dispose) {
          try {
            obj.geometry.dispose()
          } catch {}
        }
        const mat = obj?.material
        if (Array.isArray(mat)) {
          for (const m of mat) {
            if (m?.dispose) {
              try {
                m.dispose()
              } catch {}
            }
          }
        } else if (mat?.dispose) {
          try {
            mat.dispose()
          } catch {}
        }
      })
    }

    const meshDataToThree = (THREE: any, mesh: MeshData) => {
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute("position", new THREE.BufferAttribute(mesh.positions, 3))
      geometry.setAttribute("normal", new THREE.BufferAttribute(mesh.normals, 3))
      geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1))
      geometry.computeBoundingBox()
      const [r, g, b, a] = (mesh as any).color ?? [0.7, 0.7, 0.75, 1]
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color(r, g, b),
        transparent: a < 1,
        opacity: typeof a === "number" ? a : 1,
        side: THREE.DoubleSide,
      })
      const threeMesh = new THREE.Mesh(geometry, material)
      threeMesh.userData.expressId = mesh.expressId
      if (typeof (mesh as any).ifcType === "string") threeMesh.userData.ifcType = (mesh as any).ifcType
      const bb = geometry.boundingBox
      if (bb) threeMesh.userData.meshZMax = bb.max.z
      return threeMesh
    }

    const getTypeCount = (store: IfcDataStore, keys: string[]) => {
      for (const k of keys) {
        const ids = store.entityIndex.byType.get(k)
        if (Array.isArray(ids)) return ids.length
      }
      return 0
    }

    const getFirstByType = (store: IfcDataStore, keys: string[]) => {
      for (const k of keys) {
        const ids = store.entityIndex.byType.get(k)
        if (Array.isArray(ids) && ids.length) return ids[0]
      }
      return null
    }

    const loadModel = async () => {
      const t = threeRef.current
      if (!t?.scene || !t?.THREE) return
      const hasUrl = Boolean(modelUrl)
      const hasFile = Boolean(localFile)
      if (!hasUrl && !hasFile) return

      const fileName = localFile?.name ?? modelFileName ?? null

      setStatus(loadSimplified ? "Loading simplified model (first floor)…" : "Loading IFC model…")
      setTooltip(null)
      if (selectedMeshRef.current?.material?.emissive) {
        try {
          selectedMeshRef.current.material.emissive.setHex(0x000000)
        } catch {}
      }
      selectedMeshRef.current = null

      if (t.ifcGroup) {
        t.scene.remove(t.ifcGroup)
        disposeGroup(t.ifcGroup)
        t.ifcGroup = null
      }

      let buffer: ArrayBuffer
      try {
        if (localFile) {
          buffer = await localFile.arrayBuffer()
        } else {
          const res = await fetch(String(modelUrl))
          if (!res.ok) throw new Error(`Fetch failed (${res.status})`)
          buffer = await res.arrayBuffer()
        }
      } catch (e: any) {
        setStatus(`Failed to load IFC bytes: ${String(e?.message ?? e)}`)
        return
      }

      const fileSizeMB = buffer.byteLength / 1_048_576

      try {
        if (!ifcRuntimeRef.current) {
          ifcRuntimeRef.current = {
            parser: new IfcParser(),
            geometry: new GeometryProcessor(),
            ready: false,
            store: null,
          }
        }
        const rt = ifcRuntimeRef.current
        if (!rt.ready) {
          await rt.geometry.init()
          rt.ready = true
        }

        const store = await rt.parser.parseColumnar(buffer, {
          onProgress: (p) => {
            const pct = Number.isFinite(Number((p as any)?.percent)) ? Number((p as any).percent) : 0
            setStatus(`Parsing: ${String((p as any)?.phase ?? "IFC")} ${pct.toFixed(0)}%`)
          },
        })
        rt.store = store

        const group = new t.THREE.Group()
        group.name = "ifcGroup"
        t.ifcGroup = group
        t.scene.add(group)

        let added = 0
        const u8 = new Uint8Array(buffer)
        const gen = rt.geometry.processAdaptive(u8, {
          sizeThreshold: 2_000_000,
          batchSize: { initialBatchSize: 50, maxBatchSize: 400, fileSizeMB },
        })
        for await (const ev of gen as any) {
          if (ev?.type === "batch" && Array.isArray(ev.meshes)) {
            for (const md of ev.meshes as MeshData[]) {
              group.add(meshDataToThree(t.THREE, md))
              added++
            }
            setStatus(`Building geometry… ${added} meshes`)
          }
          if (ev?.type === "complete") break
        }

        const box = new t.THREE.Box3().setFromObject(group)
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

        if (loadSimplified) {
          const cutoff = box.min.z + 4.0
          group.traverse((obj: any) => {
            if (typeof obj?.userData?.meshZMax === "number") obj.visible = obj.userData.meshZMax <= cutoff
          })
          setStatus("Simplified view: Showing approx. first storey only.")
        } else {
          setStatus("IFC loaded. Use mouse/touch to orbit, pan, and zoom.")
        }

        const storeys = getTypeCount(store, ["IFCBUILDINGSTOREY", "IfcBuildingStorey"])
        const buildingId = getFirstByType(store, ["IFCBUILDING", "IfcBuilding"])
        const buildingAttrs = buildingId != null ? extractEntityAttributesOnDemand(store, buildingId) : null
        const element_counts = {
          columns: getTypeCount(store, ["IFCCOLUMN", "IfcColumn"]),
          beams: getTypeCount(store, ["IFCBEAM", "IfcBeam"]),
          footings: getTypeCount(store, ["IFCFOOTING", "IfcFooting"]),
          walls: getTypeCount(store, ["IFCWALL", "IFCWALLSTANDARDCASE", "IfcWall", "IfcWallStandardCase"]),
        }

        const warnings: string[] = []
        if (fileSizeMB >= 50) warnings.push(`Large IFC file (${fileSizeMB.toFixed(1)} MB). Simplified mode may be faster.`)

        setIfcViz({
          ok: true,
          model_url: hasUrl ? String(modelUrl) : undefined,
          file_name: fileName,
          storeys: storeys || undefined,
          element_counts,
          building:
            buildingAttrs?.name || size.z
              ? {
                  name: buildingAttrs?.name || undefined,
                  height_m: size.z || null,
                }
              : null,
          warnings,
        })
      } catch (e: any) {
        setStatus(`Failed to parse/render IFC: ${String(e?.message ?? e)}`)
      }
    }

    loadModel()
  }, [modelUrl, localFile, loadSimplified, modelFileName])

  useEffect(() => {
    const t = threeRef.current
    if (!t?.ifcGroup || !t?.THREE) return
    const hasFail = (complianceResult?.summary?.fail_count ?? 0) > 0
    const hasWarn = (complianceResult?.summary?.warning_count ?? 0) > 0
    const color = hasFail ? new t.THREE.Color(0xd9463f) : hasWarn ? new t.THREE.Color(0xeab308) : new t.THREE.Color(0x16a34a)
    t.ifcGroup.traverse((obj: any) => {
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
  }, [complianceResult, modelUrl, localFile])

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
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ifc"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null
                    if (!f) return
                    setTooltip(null)
                    setModelUrl(null)
                    setLocalFile(f)
                    setModelFileName(f.name)
                  }}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="bg-white/80 backdrop-blur-sm border border-gray-300 text-gray-900 h-8 px-2"
                  onClick={() => fileInputRef.current?.click()}
                >
                  Open IFC
                </Button>
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
                Ask in chat: &quot;Analyze this model against BCP-SP 2021&quot; to run screening checks at the building location.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
