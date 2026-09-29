import { useRef, useEffect } from "react";
import Map, { Marker, type MapRef } from "react-map-gl/mapbox";
import { Navigation, MapPin } from "lucide-react";
import type { Shipment } from "@/types";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

interface DashboardMapProps {
  shipments: Shipment[];
  onShipmentClick?: (id: string) => void;
  className?: string;
}

export function DashboardMap({ shipments, onShipmentClick, className }: DashboardMapProps) {
  const mapRef = useRef<MapRef>(null);

  // Center on India
  const INDIA_CENTER = { latitude: 20.5937, longitude: 78.9629 };

  // Fit to markers
  useEffect(() => {
    if (!mapRef.current || shipments.length === 0) return;
    const lats = shipments.flatMap((s) => [Number(s.originLat), Number(s.destinationLat)]);
    const lngs = shipments.flatMap((s) => [Number(s.originLng), Number(s.destinationLng)]);
    if (lats.length === 0) return;
    mapRef.current.fitBounds(
      [[Math.min(...lngs) - 1, Math.min(...lats) - 1], [Math.max(...lngs) + 1, Math.max(...lats) + 1]],
      { padding: 40, duration: 1000 }
    );
  }, [shipments]);

  if (!MAPBOX_TOKEN) {
    return (
      <div className={`flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-50 rounded-xl border border-slate-200 ${className ?? "h-64"}`}>
        <div className="text-center text-slate-400">
          <MapPin className="w-8 h-8 mx-auto mb-2 text-slate-300" />
          <p className="text-sm font-medium">Live Map</p>
          <p className="text-xs mt-0.5">Set VITE_MAPBOX_TOKEN to enable</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl overflow-hidden border border-slate-200 shadow-sm ${className ?? "h-64"}`}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ ...INDIA_CENTER, zoom: 4.5 }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
      >
        {shipments.map((s) => {
          const isAtRisk = s.status === "AT_RISK" || s.status === "DELAYED";
          return (
            <Marker
              key={s.id}
              latitude={Number(s.originLat)}
              longitude={Number(s.originLng)}
              anchor="center"
              onClick={(e) => { e.originalEvent.stopPropagation(); onShipmentClick?.(s.id); }}
            >
              <div
                className={`w-7 h-7 rounded-full border-2 border-white shadow-lg flex items-center justify-center cursor-pointer transition-transform hover:scale-110 ${isAtRisk ? "bg-red-500" : "bg-indigo-600"}`}
                title={`${s.trackingNumber}: ${s.originCity} → ${s.destinationCity}`}
              >
                <Navigation className="w-3.5 h-3.5 text-white" />
              </div>
            </Marker>
          );
        })}
      </Map>
    </div>
  );
}
