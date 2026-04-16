import { useState, useRef, useEffect } from 'react';
import { Search } from 'lucide-react';
import { Input } from './ui/input';
import { Button } from './ui/button';
import 'ol/ol.css';
import ChatbotWidget from './ChatbotWidget';
import { Soil3DProfile } from './Soil3DProfile';

interface SoilData {
  location: string;
  shearModulus: number;
  liquefactionFactor: number;
  pWaveVelocity: number;
  loadingRisk: 'high' | 'medium' | 'low';
  settlementRisk: 'high' | 'medium' | 'low';
  soilType: string;
  sptnValue: number;
  dryDensity: string;
  runoffClass: string;
  runoffDepth: string;
  moisture: string;
  plasticity: string;
  sandContent: string;
  clayContent: string;
  siltContent: string;
  insituDensity: string;
  gravelContent: string;
  finesContent: string;
  liquidLimit: string;
  plasticLimit: string;
  plasticityIndex: string;
  specificGravity: string;
}

// Default data when no site is selected
const defaultData: SoilData = {
  location: 'Select a site from the map',
  shearModulus: 0,
  liquefactionFactor: 0,
  pWaveVelocity: 0,
  loadingRisk: 'low',
  settlementRisk: 'low',
  soilType: 'N/A',
  sptnValue: 0,
  dryDensity: 'N/A',
  runoffClass: 'N/A',
  runoffDepth: 'N/A',
  moisture: 'N/A',
  plasticity: 'N/A',
  sandContent: 'N/A',
  clayContent: 'N/A',
  siltContent: 'N/A',
  insituDensity: 'N/A',
  gravelContent: 'N/A',
  finesContent: 'N/A',
  liquidLimit: 'N/A',
  plasticLimit: 'N/A',
  plasticityIndex: 'N/A',
  specificGravity: 'N/A'
};

// Interface for GeoJSON feature properties
interface SiteProperties {
  id: number;
  site: string;
  latitude: number;
  longitude: number;
  moisture_content: any;
  insitu_density: any;
  dry_density: any;
  pct_gravel: any;
  pct_sand: any;
  pct_fines: any;
  ll: any;
  pl: any;
  specific_gravity: any;
  bender_element_vs: any;
  shear_modulus: any;
}

export function SoilAnalysis() {
  const [searchQuery, setSearchQuery] = useState('');
  const [data, setData] = useState<SoilData>(defaultData);
  const [selectedSite, setSelectedSite] = useState<string>('');
  const [show3DView, setShow3DView] = useState<boolean>(false);
  const mapRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<any>(null);
  const mapInstanceRef = useRef<any>(null);
  const selectedFeatureRef = useRef<any>(null);
  const [coordinates, setCoordinates] = useState<{ lat: number; lon: number }>({ lat: 0, lon: 0 });
  const [scale, setScale] = useState<string>('');
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [selectedFeature, setSelectedFeature] = useState<any>(null);
  const [mapError, setMapError] = useState<string>('');

  // Safe number conversion function that handles both numbers and strings
  const safeToFixed = (value: any, decimals: number): string => {
    if (value === null || value === undefined) return 'N/A';
    
    // Convert to number if it's a string
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    
    // Check if it's a valid number
    if (isNaN(numValue)) return 'N/A';
    
    return numValue.toFixed(decimals);
  };

  // Safe number conversion for calculations
  const safeNumber = (value: any): number => {
    if (value === null || value === undefined) return 0;
    const numValue = typeof value === 'string' ? parseFloat(value) : value;
    return isNaN(numValue) ? 0 : numValue;
  };

  useEffect(() => {
    const initializeMap = async () => {
      try {
        const Map = await import('ol/Map').then(m => m.default);
        const View = await import('ol/View').then(m => m.default);
        const TileLayer = await import('ol/layer/Tile').then(m => m.default);
        const VectorLayer = await import('ol/layer/Vector').then(m => m.default);
        const VectorSource = await import('ol/source/Vector').then(m => m.default);
        const GeoJSON = await import('ol/format/GeoJSON').then(m => m.default);
        const OSM = await import('ol/source/OSM').then(m => m.default);
        const fromLonLat = await import('ol/proj').then(m => m.fromLonLat);
        const toLonLat = await import('ol/proj').then(m => m.toLonLat);
        const Style = await import('ol/style/Style').then(m => m.default);
        const Fill = await import('ol/style/Fill').then(m => m.default);
        const Stroke = await import('ol/style/Stroke').then(m => m.default);
        const islamabadCoords = fromLonLat([73.0479, 33.6844]);

        const boundarySource = new VectorSource({
          url: '/api/islamabad/boundary',
          format: new GeoJSON({ featureProjection: 'EPSG:3857' })
        });

        boundarySource.on('featuresloaderror', () => {
          setMapError('Failed to load AOI boundary data')
        })

        const boundaryLayer = new VectorLayer({
          source: boundarySource,
          style: [
            new Style({
              stroke: new Stroke({ color: 'rgba(13, 148, 136, 0.25)', width: 10 })
            }),
            new Style({
              stroke: new Stroke({ color: 'rgba(13, 148, 136, 0.9)', width: 3 }),
              fill: new Fill({ color: 'rgba(13, 148, 136, 0.06)' })
            })
          ]
        });

        const openMap = new Map({
          target: mapRef.current!,
          layers: [
            new TileLayer({
              source: new OSM()
            }),
            boundaryLayer,
          ],
          view: new View({
            center: islamabadCoords,
            zoom: 12,
            minZoom: 10,
            maxZoom: 18
          })
        });

        boundarySource.once('change', () => {
          if (boundarySource.getState() === 'ready') {
            const extent = boundarySource.getExtent();
            openMap.getView().fit(extent, { padding: [20, 20, 20, 20], duration: 350 });
            openMap.getView().setExtent(extent as any);
          }
        });

        // Add click event to vector layer
        openMap.on('click', async (evt) => {
          try {
            setIsLoading(true);
            setMapError('');
            const coords = toLonLat(evt.coordinate);
            const lon = Number(coords[0].toFixed(6));
            const lat = Number(coords[1].toFixed(6));

            const res = await fetch(`/api/islamabad/sample?lon=${lon}&lat=${lat}`);
            if (!res.ok) {
              const t = await res.text().catch(() => '');
              setMapError(t || `Sampling failed (${res.status})`);
              setIsLoading(false);
              return;
            }

            let json: any = null;
            try {
              json = await res.json();
            } catch {
              setMapError('Sampling failed (bad response)');
              setIsLoading(false);
              return;
            }

            if (!json?.ok) {
              setMapError(json?.error ?? 'Sampling failed');
              setIsLoading(false);
              return;
            }

            if (!json?.sample?.inBounds) {
              setMapError('Selected location is outside the supported AOI grid');
              setIsLoading(false);
              return;
            }

            const currentZoom = openMap.getView().getZoom() ?? 12;
            openMap.getView().animate({
              center: evt.coordinate,
              zoom: Math.min(16, currentZoom + 1),
              duration: 350
            });

            const layers = json.sample?.layers ?? {};
            const vsPred = layers.pred_vs_sw ?? null;
            const vpPred = layers.pred_vp_pw ?? null;
            const sub = json.tables?.subbasin ?? null;
            const bulkDensity = layers.bulk_density ?? null;
            const waterPct = layers.water_content ?? null;

            const rhoKgM3 = typeof bulkDensity === 'number' ? bulkDensity * 1000 : null;
            const gMpa = typeof vsPred === 'number' && typeof rhoKgM3 === 'number' ? (rhoKgM3 * vsPred * vsPred) / 1_000_000 : null;

            setSelectedFeature(null);
            selectedFeatureRef.current = null;
            setSelectedSite('');

            const soilData: SoilData = {
              location: `Lon ${lon.toFixed(4)}, Lat ${lat.toFixed(4)}`,
              shearModulus: typeof gMpa === 'number' ? Math.round(gMpa) : 0,
              liquefactionFactor: typeof vsPred === 'number' ? vsPred : 0,
              pWaveVelocity: typeof vpPred === 'number' ? vpPred : 0,
              loadingRisk: getRiskLevel(typeof waterPct === 'number' ? waterPct : 0),
              settlementRisk: 'low',
              soilType: getSoilType(
                typeof layers.sand_pct === 'number' ? layers.sand_pct : 0,
                typeof layers.silt_pct === 'number' ? layers.silt_pct : 0,
                typeof layers.clay_pct === 'number' ? layers.clay_pct : 0,
              ),
              sptnValue: typeof gMpa === 'number' ? Math.max(0, Math.round(gMpa / 10)) : 0,
              dryDensity: typeof bulkDensity === 'number' ? `${bulkDensity.toFixed(2)} g/cm³` : 'N/A',
              runoffClass: typeof sub?.runoffClass === 'number' ? String(sub.runoffClass) : 'N/A',
              runoffDepth: typeof sub?.runoffDepthMmMean === 'number' ? `${sub.runoffDepthMmMean.toFixed(0)} mm` : 'N/A',
              moisture: typeof waterPct === 'number' ? `${waterPct.toFixed(1)}%` : 'N/A',
              plasticity: 'N/A',
              sandContent: typeof layers.sand_pct === 'number' ? `${layers.sand_pct.toFixed(1)}%` : 'N/A',
              clayContent: typeof layers.clay_pct === 'number' ? `${layers.clay_pct.toFixed(1)}%` : 'N/A',
              siltContent: typeof layers.silt_pct === 'number' ? `${layers.silt_pct.toFixed(1)}%` : 'N/A',
              insituDensity: typeof bulkDensity === 'number' ? `${bulkDensity.toFixed(2)} g/cm³` : 'N/A',
              gravelContent: 'N/A',
              finesContent:
                typeof layers.silt_pct === 'number' && typeof layers.clay_pct === 'number'
                  ? `${(layers.silt_pct + layers.clay_pct).toFixed(1)}%`
                  : 'N/A',
              liquidLimit: 'N/A',
              plasticLimit: 'N/A',
              plasticityIndex: 'N/A',
              specificGravity: 'N/A',
            };

            setData(soilData);
          } finally {
            setIsLoading(false);
          }
        });

        // Safe coordinate and scale update
        const updateScaleAndCoords = (evt: any) => {
          try {
            if (evt.coordinate) {
              const coords = toLonLat(evt.coordinate);
              setCoordinates({
                lon: parseFloat(coords[0].toFixed(6)),
                lat: parseFloat(coords[1].toFixed(6))
              });

              // Calculate scale
              const view = openMap.getView();
              const resolution = view.getResolution();
              const units = view.getProjection().getUnits();
              const dpi = 96;
              const inchesPerMeter = 39.37;
              
              if (resolution && units === 'm') {
                const scaleValue = Math.round(resolution * dpi * inchesPerMeter);
                setScale(`1 : ${scaleValue.toLocaleString()}`);
              }
            }
          } catch (error) {
          }
        };

        openMap.on('pointermove', updateScaleAndCoords);
        openMap.on('moveend', updateScaleAndCoords);

        setMap(openMap);
        mapInstanceRef.current = openMap;
      } catch (error) {
      }
    };

    if (mapRef.current) {
      initializeMap();
    }

    return () => {
      const inst = mapInstanceRef.current
      if (inst) {
        inst.setTarget(undefined)
        mapInstanceRef.current = null
      }
    };
  }, []);

  useEffect(() => {
    const onChatData = async (ev: any) => {
      const d = ev?.detail ?? null
      const inst = mapInstanceRef.current
      if (!d || !inst) return
      if (d.type === 'location' && d.nearest?.lon != null && d.nearest?.lat != null) {
        await sampleAtLonLat(Number(d.nearest.lon), Number(d.nearest.lat), inst)
        return
      }
      if (d.type === 'sector' && d.sector) {
        setSearchQuery(String(d.sector))
        setMapError('')
      }
    }
    window.addEventListener('vs-chat-data', onChatData as any)
    return () => window.removeEventListener('vs-chat-data', onChatData as any)
  }, [])

  const parseSearchCoordinates = (query: string): { lon: number; lat: number } | null => {
    const parts = query
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length !== 2) return null;
    const a = Number(parts[0]);
    const b = Number(parts[1]);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

    const aIsLat = Math.abs(a) <= 90;
    const bIsLat = Math.abs(b) <= 90;

    if (aIsLat && !bIsLat) return { lat: a, lon: b };
    if (!aIsLat && bIsLat) return { lat: b, lon: a };
    return { lat: a, lon: b };
  };

  const sampleAtLonLat = async (lon: number, lat: number, mapInstance: any) => {
    try {
      setIsLoading(true);
      setMapError('');
      const res = await fetch(`/api/islamabad/sample?lon=${lon}&lat=${lat}`);
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        setMapError(t || `Sampling failed (${res.status})`);
        return;
      }
      const json = await res.json().catch(() => null);
      if (!json?.ok) {
        setMapError(json?.error ?? 'Sampling failed');
        return;
      }
      if (!json?.sample?.inBounds) {
        setMapError('Selected location is outside the supported AOI grid');
        return;
      }

      const fromLonLat = await import('ol/proj').then((m) => m.fromLonLat);
      const center = fromLonLat([lon, lat]);
      const currentZoom = mapInstance.getView().getZoom() ?? 12;
      mapInstance.getView().animate({
        center,
        zoom: Math.min(16, currentZoom + 1),
        duration: 350
      });

      const layers = json.sample?.layers ?? {};
      const vsPred = layers.pred_vs_sw ?? null;
      const vpPred = layers.pred_vp_pw ?? null;
      const sub = json.tables?.subbasin ?? null;
      const bulkDensity = layers.bulk_density ?? null;
      const waterPct = layers.water_content ?? null;

      const rhoKgM3 = typeof bulkDensity === 'number' ? bulkDensity * 1000 : null;
      const gMpa = typeof vsPred === 'number' && typeof rhoKgM3 === 'number' ? (rhoKgM3 * vsPred * vsPred) / 1_000_000 : null;

      setSelectedFeature(null);
      selectedFeatureRef.current = null;
      setSelectedSite('');

      const soilData: SoilData = {
        location: `Lon ${lon.toFixed(4)}, Lat ${lat.toFixed(4)}`,
        shearModulus: typeof gMpa === 'number' ? Math.round(gMpa) : 0,
        liquefactionFactor: typeof vsPred === 'number' ? vsPred : 0,
        pWaveVelocity: typeof vpPred === 'number' ? vpPred : 0,
        loadingRisk: getRiskLevel(typeof waterPct === 'number' ? waterPct : 0),
        settlementRisk: 'low',
        soilType: getSoilType(
          typeof layers.sand_pct === 'number' ? layers.sand_pct : 0,
          typeof layers.silt_pct === 'number' ? layers.silt_pct : 0,
          typeof layers.clay_pct === 'number' ? layers.clay_pct : 0,
        ),
        sptnValue: 0,
        dryDensity: typeof bulkDensity === 'number' ? `${bulkDensity.toFixed(2)} g/cm³` : 'N/A',
        runoffClass: typeof sub?.runoffClass === 'number' ? String(sub.runoffClass) : 'N/A',
        runoffDepth: typeof sub?.runoffDepthMmMean === 'number' ? `${sub.runoffDepthMmMean.toFixed(0)} mm` : 'N/A',
        moisture: typeof waterPct === 'number' ? `${waterPct.toFixed(1)}%` : 'N/A',
        plasticity: 'N/A',
        sandContent: typeof layers.sand_pct === 'number' ? `${layers.sand_pct.toFixed(1)}%` : 'N/A',
        clayContent: typeof layers.clay_pct === 'number' ? `${layers.clay_pct.toFixed(1)}%` : 'N/A',
        siltContent: typeof layers.silt_pct === 'number' ? `${layers.silt_pct.toFixed(1)}%` : 'N/A',
        insituDensity: typeof bulkDensity === 'number' ? `${bulkDensity.toFixed(2)} g/cm³` : 'N/A',
        gravelContent: 'N/A',
        finesContent:
          typeof layers.silt_pct === 'number' && typeof layers.clay_pct === 'number'
            ? `${(layers.silt_pct + layers.clay_pct).toFixed(1)}%`
            : 'N/A',
        liquidLimit: 'N/A',
        plasticLimit: 'N/A',
        plasticityIndex: 'N/A',
        specificGravity: 'N/A',
      };

      setData(soilData);
      try {
        localStorage.setItem('seismic_last_location', JSON.stringify({ lat, lon }))
      } catch {}
      window.dispatchEvent(new CustomEvent('vs-chat-context', { detail: { lat, lon } }))
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async () => {
    const q = searchQuery.trim();
    if (!q) return;
    const mapInstance = mapInstanceRef.current;
    if (!mapInstance) return;

    const coords = parseSearchCoordinates(q);
    if (coords) {
      await sampleAtLonLat(Number(coords.lon.toFixed(6)), Number(coords.lat.toFixed(6)), mapInstance);
      return;
    }

    try {
      const res = await fetch('/api/query', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ type: 'sector', value: q, depth: 2.0 }),
      })
      if (res.ok) {
        const json = await res.json().catch(() => null)
        const lon = Number(json?.centroid?.lon)
        const lat = Number(json?.centroid?.lat)
        if (json?.ok && Number.isFinite(lon) && Number.isFinite(lat)) {
          await sampleAtLonLat(Number(lon.toFixed(6)), Number(lat.toFixed(6)), mapInstance)
          setMapError('')
          return
        }
      }
    } catch {}

    try {
      const res = await fetch(`/api/sites?limit=5000&page=1`);
      if (res.ok) {
        const json = await res.json().catch(() => null);
        const remote = json?.features ?? [];
        const hit = remote.find((f: any) => String(f?.properties?.site ?? '').toLowerCase().includes(q.toLowerCase()));
        const coords2 = hit?.geometry?.coordinates ?? null;
        if (Array.isArray(coords2) && coords2.length === 2) {
          const lon = Number(coords2[0]);
          const lat = Number(coords2[1]);
          if (Number.isFinite(lon) && Number.isFinite(lat)) {
            await sampleAtLonLat(Number(lon.toFixed(6)), Number(lat.toFixed(6)), mapInstance);
            setMapError('');
            return;
          }
        }
      }
    } catch {}

    setMapError('No matching site name or coordinate found');
  };

  // Function to zoom to a specific feature
  const zoomToFeature = async (feature: any, mapInstance: any) => {
  try {
    const View = await import('ol/View').then(m => m.default);
    const fromLonLat = await import('ol/proj').then(m => m.fromLonLat);
    
    const properties = feature.getProperties() as SiteProperties;
    
    // Get the coordinates from the feature properties
    const center = fromLonLat([properties.longitude, properties.latitude]);
    
    // Gentle zoom - just enough to center on the point
    mapInstance.getView().animate({
      center: center,
      zoom: 14, // Even more reasonable zoom
      duration: 500
    });
    
  } catch (error) {
  }
};

  // Function to reset zoom to default view
  const resetZoom = async () => {
    if (!map) return;
    
    try {
      const fromLonLat = await import('ol/proj').then(m => m.fromLonLat);
      
      // Islamabad coordinates
      const islamabadCoords = fromLonLat([73.0479, 33.6844]);
      
      map.getView().animate({
        center: islamabadCoords,
        zoom: 12,
        duration: 500
      });
      
      // Reset selection
      setSelectedFeature(null);
      setSelectedSite('');
      setData(defaultData);
    } catch (error) {
    }
  };

  const handleSiteClick = async (properties: SiteProperties, feature: any) => {
    setSelectedSite(properties.site);
    setSelectedFeature(feature);

    const lon = Number(properties.longitude);
    const lat = Number(properties.latitude);
    const hasDbSoilProps =
      safeNumber(properties.pct_sand) > 0 ||
      safeNumber(properties.pct_fines) > 0 ||
      safeNumber(properties.moisture_content) > 0 ||
      safeNumber(properties.insitu_density) > 0 ||
      safeNumber(properties.shear_modulus) > 0;

    if (!hasDbSoilProps && Number.isFinite(lon) && Number.isFinite(lat) && mapInstanceRef.current) {
      await sampleAtLonLat(Number(lon.toFixed(6)), Number(lat.toFixed(6)), mapInstanceRef.current);
      return;
    }
    
    // Convert database properties to SoilData format
    const soilData: SoilData = {
      location: properties.site,
      shearModulus: safeNumber(properties.shear_modulus),
      liquefactionFactor: safeNumber(properties.bender_element_vs),
      pWaveVelocity: 0,
      loadingRisk: getRiskLevel(safeNumber(properties.moisture_content)),
      settlementRisk: getRiskLevel(safeNumber(properties.insitu_density)),
      soilType: getSoilType(
        safeNumber(properties.pct_sand),
        0,
        safeNumber(properties.pct_fines),
      ),
      sptnValue: safeNumber(properties.shear_modulus) ? Math.round(safeNumber(properties.shear_modulus) / 10) : 0,
      dryDensity: properties.dry_density ? `${safeToFixed(properties.dry_density, 2)} g/cm³` : 'N/A',
      runoffClass: 'N/A',
      runoffDepth: 'N/A',
      moisture: properties.moisture_content ? `${safeToFixed(properties.moisture_content, 1)}%` : 'N/A',
      plasticity: properties.ll ? (safeNumber(properties.ll) > 30 ? 'High' : 'Low') : 'N/A',
      sandContent: properties.pct_sand ? `${safeToFixed(properties.pct_sand, 1)}%` : 'N/A',
      clayContent: properties.pct_fines ? `${safeToFixed((safeNumber(properties.pct_fines) * 0.7), 1)}%` : 'N/A',
      siltContent: properties.pct_fines ? `${safeToFixed((safeNumber(properties.pct_fines) * 0.3), 1)}%` : 'N/A',
      insituDensity: properties.insitu_density ? `${safeToFixed(properties.insitu_density, 2)} g/cm³` : 'N/A',
      gravelContent: properties.pct_gravel ? `${safeToFixed(properties.pct_gravel, 1)}%` : 'N/A',
      finesContent: properties.pct_fines ? `${safeToFixed(properties.pct_fines, 1)}%` : 'N/A',
      liquidLimit: properties.ll ? `${safeToFixed(properties.ll, 1)}` : 'N/A',
      plasticLimit: properties.pl ? `${safeToFixed(properties.pl, 1)}` : 'N/A',
      plasticityIndex:
        properties.ll && properties.pl ? `${safeToFixed(safeNumber(properties.ll) - safeNumber(properties.pl), 1)}` : 'N/A',
      specificGravity: properties.specific_gravity ? `${safeToFixed(properties.specific_gravity, 2)}` : 'N/A'
    };
    
    setData(soilData);

    try {
      setIsLoading(true);
      const res = await fetch(`/api/islamabad/sample?lon=${lon}&lat=${lat}&site=${encodeURIComponent(properties.site)}`);
      if (!res.ok) return;
      const json = await res.json().catch(() => null);
      if (!json?.ok) return;
      const sub = json.tables?.subbasin ?? null;
      if (!sub) return;
      setData((prev) => ({
        ...prev,
        runoffClass: typeof sub?.runoffClass === 'number' ? String(sub.runoffClass) : prev.runoffClass,
        runoffDepth: typeof sub?.runoffDepthMmMean === 'number' ? `${sub.runoffDepthMmMean.toFixed(0)} mm` : prev.runoffDepth,
      }));
    } finally {
      setIsLoading(false);
    }
  };

  // Helper function to determine risk level based on soil properties
  const getRiskLevel = (value: number): 'high' | 'medium' | 'low' => {
    if (!value || value === 0) return 'low';
    if (value > 15) return 'high';
    if (value > 10) return 'medium';
    return 'low';
  };

  // Helper function to determine soil type
  const getSoilType = (sand: number, silt: number, clay: number): string => {
    const s = safeNumber(sand);
    const si = safeNumber(silt);
    const c = safeNumber(clay);
    const sum = s + si + c;
    if (sum <= 0) return 'Unknown';

    const sp = (s / sum) * 100;
    const sip = (si / sum) * 100;
    const cp = (c / sum) * 100;

    if (cp >= 40) return 'Clay';
    if (sp >= 70 && cp < 15) return 'Sand';
    if (sip >= 70 && cp < 20) return 'Silt';
    if (sp >= sip && sp >= cp) return sp >= 50 ? 'Silty Sand' : 'Sand (mixed)';
    if (sip >= sp && sip >= cp) return sip >= 50 ? 'Sandy Silt' : 'Silt (mixed)';
    return 'Clay (mixed)';
  };

  const getRiskColor = (level: string) => {
    switch (level) {
      case 'high': return '#ef4444';
      case 'medium': return '#f59e0b';
      case 'low': return '#10b981';
      default: return '#64748b';
    }
  };

  const hasSelection = data.location !== defaultData.location;

  return (
    <div className="h-screen overflow-hidden bg-white text-gray-900">
      <ChatbotWidget />
      <div className="w-full max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-3 h-full flex flex-col">
        {/* Header and Search Bar */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mb-3">
          <div className="lg:col-span-4">
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">Geotechnical Analysis Platform</h1>
          </div>
          
          <div className="lg:col-span-8">
            <div className="flex gap-2">
              <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <Input
                type="text"
                placeholder="Search site/sector (e.g., G-6) or coordinates (lat, lon)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleSearch()
                }}
                className="pl-10 bg-gray-100 border-gray-300 text-gray-900 placeholder:text-gray-500 h-10 text-sm"
              />
              </div>
              <Button
                className="h-10 bg-blue-600 hover:bg-blue-700 text-white"
                onClick={handleSearch}
                disabled={isLoading}
              >
                Search
              </Button>
              <Button
                className="h-10 bg-gray-200 hover:bg-gray-300 text-gray-900 border border-gray-400 px-4"
                onClick={resetZoom}
                variant="outline"
              >
                Reset View
              </Button>
            </div>
          </div>
        </div>

        {mapError && (
          <div className="mb-3 bg-red-50 border border-red-300 rounded-lg p-3">
            <div className="text-xs uppercase tracking-wider text-red-700 mb-1">Map Error</div>
            <div className="text-sm text-red-600">{mapError}</div>
          </div>
        )}

        {/* Main Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-3 flex-1 min-h-0">
          {/* Left Column - Metrics */}
          <div className="lg:col-span-7 flex flex-col gap-3 h-full min-h-0">
            {/* Row 1: Shear Modulus and Bender Element */}
            <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 mt-1">
              {/* Shear Modulus */}
              <div className="sm:col-span-2 bg-gray-50 border border-gray-300 rounded-lg p-2">
                <h3 className="text-sm uppercase tracking-wider text-[#0d9488] mb-1">Shear Modulus</h3>
                <div className="flex items-center justify-center">
                  <div className="relative w-[148px] h-[148px]">
                    <svg className="transform -rotate-90 w-[148px] h-[148px]" viewBox="0 0 80 80">
                      <circle
                        cx="40"
                        cy="40"
                        r="35"
                        stroke="#d1d5db"
                        strokeWidth="6"
                        fill="none"
                      />
                      <circle
                        cx="40"
                        cy="40"
                        r="35"
                        stroke="#0d9488"
                        strokeWidth="6"
                        fill="none"
                        strokeLinecap="round"
                        strokeDasharray={`${(Math.min(100, Math.max(0, data.shearModulus)) / 100) * 219.8} 219.8`}
                      />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <div className="text-4xl font-semibold text-gray-900 leading-none">{data.shearModulus}</div>
                      <div className="text-xs tracking-wide text-gray-600">MPa</div>
                    </div>
                  </div>
                </div>
                <div className="mt-1 text-xs text-gray-600 text-center">0–100 MPa</div>
              </div>

              {/* Bender Element */}
              <div className="sm:col-span-3 bg-gray-50 border border-gray-300 rounded-lg p-2">
                <h3 className="text-sm uppercase tracking-wider text-[#0d9488] mb-1">Bender Element</h3>
                <div className="flex items-center justify-center gap-3">
                  <div className="relative w-[140px] h-[140px]">
                    <svg className="transform -rotate-90 w-[140px] h-[140px]" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="35" stroke="#d1d5db" strokeWidth="6" fill="none" />
                        <circle
                          cx="40"
                          cy="40"
                          r="35"
                          stroke="#0d9488"
                          strokeWidth="6"
                          fill="none"
                          strokeLinecap="round"
                          strokeDasharray={`${Math.min(1, Math.max(0, safeNumber(data.liquefactionFactor)) / 400) * 219.8} 219.8`}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className="text-3xl font-semibold text-gray-900 leading-none">{safeToFixed(data.liquefactionFactor, 0)}</div>
                        <div className="text-xs tracking-wide text-gray-600">Vs (m/s)</div>
                      </div>
                    </div>
                    <div className="relative w-[140px] h-[140px]">
                      <svg className="transform -rotate-90 w-[140px] h-[140px]" viewBox="0 0 80 80">
                        <circle cx="40" cy="40" r="35" stroke="#d1d5db" strokeWidth="6" fill="none" />
                        <circle
                          cx="40"
                          cy="40"
                          r="35"
                          stroke="#f59e0b"
                          strokeWidth="6"
                          fill="none"
                          strokeLinecap="round"
                          strokeDasharray={`${Math.min(1, Math.max(0, safeNumber(data.pWaveVelocity)) / 2000) * 219.8} 219.8`}
                        />
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className="text-3xl font-semibold text-gray-900 leading-none">
                          {data.pWaveVelocity ? safeToFixed(data.pWaveVelocity, 0) : 'N/A'}
                        </div>
                        <div className="text-xs tracking-wide text-gray-600">Vp (m/s)</div>
                      </div>
                    </div>
                </div>
              </div>
            </div>

            {/* Row 2: Soil Profile Properties */}
            <div className="bg-gray-50 border border-gray-300 rounded-lg p-3 flex-1 min-h-0">
              <h3 className="text-base uppercase tracking-wider text-[#0d9488] mb-2">Soil Profile Properties</h3>
              <div className="grid grid-cols-2 grid-rows-3 gap-3 auto-rows-fr h-full">
                {[
                  { label: 'Soil Type', value: data.soilType },
                  { label: 'Bulk Density', value: data.dryDensity },
                  { label: 'Moisture', value: data.moisture },
                  { label: '% Sand', value: data.sandContent },
                  { label: '% Silt', value: data.siltContent },
                  { label: '% Clay', value: data.clayContent },
                ]
                  .map((x) => (
                    <div key={x.label} className="bg-white border border-gray-200 rounded p-2.5 flex flex-col justify-center">
                      <div className="text-[14px] tracking-wide text-gray-600 mb-1">{x.label}</div>
                      <div className="text-[18px] font-semibold text-gray-900 leading-tight">{x.value || 'N/A'}</div>
                    </div>
                  ))}
              </div>
            </div>
          </div>

          {/* Right Column - Map */}
          <div className="lg:col-span-5 lg:self-start bg-white border border-gray-300 rounded-lg overflow-hidden relative h-[320px] lg:h-[560px] min-h-0">
            <div 
              ref={mapRef}
              className="w-full h-full"
            />
            
            {/* Map Instructions */}
            {!hasSelection && (
              <div className="absolute top-3 left-3 z-10 bg-white/90 backdrop-blur-sm text-gray-900 text-xs px-3 py-2 rounded border border-gray-300">
                Click any location within the AOI rectangle to sample grid values
              </div>
            )}

            {isLoading && (
              <div className="absolute top-3 right-3 z-10 bg-white/90 backdrop-blur-sm text-gray-900 text-xs px-3 py-2 rounded border border-gray-300">
                Sampling...
              </div>
            )}
            
            {/* Zoom Controls */}
            <div className="absolute bottom-3 right-3 flex flex-col gap-1 z-10">
              <button 
                className="bg-white/90 backdrop-blur-sm text-gray-900 p-1.5 rounded hover:bg-gray-100 transition-colors border border-gray-300"
                onClick={() => map?.getView().setZoom(map.getView().getZoom() + 1)}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                </svg>
              </button>
              <button 
                className="bg-white/90 backdrop-blur-sm text-gray-900 p-1.5 rounded hover:bg-gray-100 transition-colors border border-gray-300"
                onClick={() => map?.getView().setZoom(map.getView().getZoom() - 1)}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 12H6" />
                </svg>
              </button>
              <button 
                className="bg-white/90 backdrop-blur-sm text-gray-900 p-1.5 rounded hover:bg-gray-100 transition-colors border border-gray-300"
                onClick={resetZoom}
                title="Reset to default view"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </button>
              <button 
                className={`p-1.5 rounded hover:transition-colors border ${
                  show3DView 
                    ? 'bg-teal-100 text-teal-900 border-teal-300' 
                    : 'bg-white/90 text-gray-900 hover:bg-gray-100 border-gray-300'
                }`}
                onClick={() => setShow3DView(!show3DView)}
                title="Toggle 3D soil profile view"
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 10l-2 1m0 0l-2-1m2 1v2.5M20 7l-2 1m0 0l-2-1m2 1v2.5M14 4l-2 1m0 0l-2-1m2 1v2.5" />
                </svg>
              </button>
            </div>

            {/* Coordinates and Scale */}
            <div className="absolute bottom-3 left-3 z-10 space-y-1">
              <div className="bg-white/90 backdrop-blur-sm text-gray-900 text-[10px] px-2 py-1 rounded border border-gray-300">
                <div>Lat: {coordinates.lat}</div>
                <div>Lon: {coordinates.lon}</div>
              </div>
              
              {scale && (
                <div className="bg-white/90 backdrop-blur-sm text-gray-900 text-[10px] px-2 py-0.5 rounded border border-gray-300">
                  {scale}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 3D Soil Profile Modal */}
        {show3DView && (
          <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg border border-gray-300 w-full h-4/5 flex flex-col">
              {/* Modal header */}
              <div className="flex items-center justify-between p-4 border-b border-gray-300 bg-gray-50">
                <h2 className="text-lg font-semibold text-gray-900">3D Soil Profile</h2>
                <button
                  onClick={() => setShow3DView(false)}
                  className="text-gray-600 hover:text-gray-900 p-1 rounded hover:bg-gray-200"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
              
              {/* 3D View */}
              <div className="flex-1 overflow-hidden bg-white">
                <Soil3DProfile 
                  data={
                    coordinates.lat !== 0 && coordinates.lon !== 0 
                      ? {
                          location: { lat: coordinates.lat, lon: coordinates.lon },
                          layers: [
                            {
                              depth: 2,
                              thickness: 2,
                              soilType: data.soilType || 'Soil Layer 1',
                              sandPercent: parseFloat(data.sandContent as string) || 0,
                              siltPercent: parseFloat(data.siltContent as string) || 0,
                              clayPercent: parseFloat(data.clayContent as string) || 0,
                              bulkDensity: parseFloat(data.dryDensity as string) || 1.8,
                              moisture: parseFloat(data.moisture as string) || 15,
                              vs: safeNumber(data.liquefactionFactor),
                              liquefactionRisk: data.loadingRisk,
                            },
                          ],
                          vs30: safeNumber(data.liquefactionFactor),
                          siteClass: 'D',
                        }
                      : null
                  }
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
