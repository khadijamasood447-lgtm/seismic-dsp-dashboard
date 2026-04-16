"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"

interface SoilLayer {
  depth: number // in meters
  thickness: number
  soilType: string
  sandPercent: number
  siltPercent: number
  clayPercent: number
  bulkDensity: number
  moisture: number
  vs: number // shear wave velocity
  liquefactionRisk: 'low' | 'medium' | 'high'
}

interface SoilProfileData {
  location: { lat: number; lon: number }
  layers: SoilLayer[]
  vs30: number
  siteClass: string
}

export function Soil3DProfile({ data }: { data: SoilProfileData | null }) {
  const mountRef = useRef<HTMLDivElement | null>(null)
  const threeRef = useRef<any>(null)
  const [status, setStatus] = useState<string>("Loading 3D soil profile...")
  const [expandedLayer, setExpandedLayer] = useState<number | null>(null)

  useEffect(() => {
    if (!mountRef.current || !data) return

    let cancelled = false
    let raf = 0

    const init = async () => {
      const THREE = await import("three")

      // Clear
      const el = mountRef.current!
      while (el.firstChild) el.removeChild(el.firstChild)

      // Scene
      const scene = new THREE.Scene()
      scene.background = new THREE.Color(0x1a1a2e)

      const w = el.clientWidth || 800
      const h = el.clientHeight || 600
      const camera = new THREE.PerspectiveCamera(60, w / h, 0.1, 1000)
      camera.position.set(8, 8, 8)

      const renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setPixelRatio(window.devicePixelRatio || 1)
      renderer.setSize(w, h)
      renderer.shadowMap.enabled = true
      el.appendChild(renderer.domElement)

      // Lighting
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
      scene.add(ambientLight)

      const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
      directionalLight.position.set(10, 15, 10)
      directionalLight.castShadow = true
      directionalLight.shadow.camera.left = -20
      directionalLight.shadow.camera.right = 20
      directionalLight.shadow.camera.top = 20
      directionalLight.shadow.camera.bottom = -5
      scene.add(directionalLight)

      // Ground plane
      const groundGeom = new THREE.PlaneGeometry(12, 12)
      const groundMat = new THREE.MeshLambertMaterial({ color: 0x4a5568 })
      const ground = new THREE.Mesh(groundGeom, groundMat)
      ground.rotation.x = -Math.PI / 2
      ground.position.y = -data.layers.reduce((sum, l) => sum + l.thickness, 0) / 2 - 0.2
      ground.receiveShadow = true
      scene.add(ground)

      // Draw soil layers
      let depthY = 0
      data.layers.forEach((layer, idx) => {
        const height = layer.thickness

        // Color based on soil type and liquefaction risk
        let color = 0x8b7355 // default brown
        if (layer.liquefactionRisk === 'high') color = 0xff4444 // red
        else if (layer.liquefactionRisk === 'medium') color = 0xffaa00 // orange
        else if (layer.sandPercent > 60) color = 0xd4a574 // sandy
        else if (layer.clayPercent > 40) color = 0x6b5344 // clayey
        else if (layer.siltPercent > 50) color = 0x9b8b7e // silty

        // Create box for layer
        const geometry = new THREE.BoxGeometry(4, height, 4)
        const material = new THREE.MeshPhongMaterial({
          color,
          shininess: 30,
          wireframe: false,
        })
        const layer3D = new THREE.Mesh(geometry, material)
        layer3D.position.y = -depthY - height / 2
        layer3D.castShadow = true
        layer3D.receiveShadow = true
        layer3D.userData = { ...layer, index: idx }
        scene.add(layer3D)

        // Label on side
        const canvas = document.createElement('canvas')
        canvas.width = 256
        canvas.height = 128
        const ctx = canvas.getContext('2d')!
        ctx.fillStyle = '#ffffff'
        ctx.font = '14px sans-serif'
        ctx.fillText(`${layer.soilType}`, 10, 30)
        ctx.font = '12px sans-serif'
        ctx.fillText(`Depth: ${depthY.toFixed(1)}-${(depthY + height).toFixed(1)}m`, 10, 50)
        ctx.fillText(`Sand: ${layer.sandPercent.toFixed(0)}% Silt: ${layer.siltPercent.toFixed(0)}% Clay: ${layer.clayPercent.toFixed(0)}%`, 10, 70)
        ctx.fillText(`Vs: ${layer.vs.toFixed(0)} m/s | Risk: ${layer.liquefactionRisk}`, 10, 90)

        const texture = new THREE.CanvasTexture(canvas)
        const spriteGeom = new THREE.PlaneGeometry(4.5, 1)
        const spriteMat = new THREE.MeshBasicMaterial({ map: texture })
        const sprite = new THREE.Mesh(spriteGeom, spriteMat)
        sprite.position.set(-2.5, -depthY - height / 2, 2.2)
        scene.add(sprite)

        depthY += height
      })

      // Camera look at center
      scene.position.y = depthY / 2
      camera.lookAt(0, 0, 0)

      // Resize handler
      const onResize = () => {
        if (!mountRef.current) return
        const w = mountRef.current.clientWidth || 800
        const h = mountRef.current.clientHeight || 600
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderer.setSize(w, h)
      }
      window.addEventListener('resize', onResize)

      // Animation loop
      const animate = () => {
        if (cancelled) return
        raf = requestAnimationFrame(animate)

        // Gentle rotation
        scene.rotation.y += 0.0005

        renderer.render(scene, camera)
      }
      animate()

      threeRef.current = { scene, camera, renderer, animate }
      setStatus(
        `Soil Profile: ${data.location.lat.toFixed(4)}, ${data.location.lon.toFixed(4)} | Vs30: ${data.vs30.toFixed(0)} m/s | Site Class ${data.siteClass}`
      )
    }

    init()

    return () => {
      cancelled = true
      if (raf) cancelAnimationFrame(raf)
      if (threeRef.current?.renderer) {
        threeRef.current.renderer.dispose()
      }
    }
  }, [data])

  if (!data) {
    return (
      <div className="w-full h-full bg-gray-100 flex items-center justify-center rounded-lg border border-gray-300">
        <p className="text-gray-600">Select a location on the map to view 3D soil profile</p>
      </div>
    )
  }

  return (
    <div className="w-full h-full flex flex-col bg-white rounded-lg border border-gray-300 overflow-hidden">
      <div ref={mountRef} className="flex-1 bg-gray-50" />

      {/* Status bar */}
      <div className="bg-gray-100 border-t border-gray-300 p-3 text-xs text-gray-700">
        {status}
      </div>

      {/* Layer legend */}
      <div className="bg-gray-100 border-t border-gray-300 p-3 max-h-32 overflow-y-auto">
        <p className="text-xs font-semibold text-gray-700 mb-2">Soil Layers:</p>
        <div className="space-y-1">
          {data.layers.map((layer, idx) => {
            let riskColor = 'bg-green-900'
            if (layer.liquefactionRisk === 'high') riskColor = 'bg-red-900'
            else if (layer.liquefactionRisk === 'medium') riskColor = 'bg-yellow-900'

            return (
              <button
                key={idx}
                onClick={() => setExpandedLayer(expandedLayer === idx ? null : idx)}
                className="w-full text-left p-2 rounded bg-gray-200 hover:bg-gray-300 transition-colors text-xs text-gray-900"
              >
                <div className="flex items-center justify-between">
                  <span className="font-mono">
                    {idx + 1}. {layer.soilType} ({layer.thickness}m)
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded text-white text-[10px] font-semibold ${riskColor}`}>
                      {layer.liquefactionRisk.toUpperCase()}
                    </span>
                    <ChevronDown
                      size={14}
                      className={`transition-transform`}
                    />
                  </div>
                </div>
                {expandedLayer === idx && (
                  <div className="mt-2 pt-2 border-t border-gray-400 space-y-1 text-[11px] text-gray-700">
                    <div>Sand: {layer.sandPercent.toFixed(1)}% | Silt: {layer.siltPercent.toFixed(1)}% | Clay: {layer.clayPercent.toFixed(1)}%</div>
                    <div>Bulk Density: {layer.bulkDensity.toFixed(2)} g/cm³ | Moisture: {layer.moisture.toFixed(1)}%</div>
                    <div>Vs: {layer.vs.toFixed(0)} m/s | Depth: {(layer.depth - layer.thickness).toFixed(1)}-{layer.depth.toFixed(1)}m</div>
                  </div>
                )}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
