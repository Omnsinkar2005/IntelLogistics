import { useEffect, useRef, useState } from "react";
import Map, { Marker, Source, Layer, type MapRef } from "react-map-gl/mapbox";
import type { ShipmentLocation, RouteEvent } from "@/types";
import { AlertTriangle, MapPin, Navigation } from "lucide-react";
import "mapbox-gl/dist/mapbox-gl.css";

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string;

interface LiveMapProps {
  originLat: number;
  originLng: number;
  destLat: number;
  destLng: number;
  currentLocation: ShipmentLocation | null;
  routePolyline?: [number, number][] | null;
  routeEvents?: RouteEvent[];
  className?: string;
}

export function LiveMap({
  originLat, originLng, destLat, destLng,
  currentLocation, routePolyline, routeEvents = [], className,
}: LiveMapProps) {
  const mapRef = useRef<MapRef>(null);

  const centerLat = (originLat + destLat) / 2;
  const centerLng = (originLng + destLng) / 2;

  // Fit bounds to show full route
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    const lats = [originLat, destLat];
    const lngs = [originLng, destLng];
    if (currentLocation) {
      lats.push(Number(currentLocation.latitude));
      lngs.push(Number(currentLocation.longitude));
    }
    map.fitBounds(
      [[Math.min(...lngs) - 0.5, Math.min(...lats) - 0.5], [Math.max(...lngs) + 0.5, Math.max(...lats) + 0.5]],
      { padding: 40, duration: 800 }
    );
  }, [currentLocation?.id]);

  const routeGeoJSON: GeoJSON.Feature<GeoJSON.LineString> | null = routePolyline
    ? { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: routePolyline } }
    : null;

  // Fallback straight line
  const fallbackLine: GeoJSON.Feature<GeoJSON.LineString> = {
    type: "Feature", properties: {},
    geometry: { type: "LineString", coordinates: [[originLng, originLat], [destLng, destLat]] },
  };

  if (!MAPBOX_TOKEN) {
    return (
      <div className={`flex items-center justify-center bg-gray-100 rounded-xl ${className ?? "h-80"}`}>
        <div className="text-center text-gray-400">
          <MapPin className="w-8 h-8 mx-auto mb-2" />
          <p className="text-sm">Map requires VITE_MAPBOX_TOKEN</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`rounded-xl overflow-hidden ${className ?? "h-80"}`}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ latitude: centerLat, longitude: centerLng, zoom: 6 }}
        style={{ width: "100%", height: "100%" }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
      >
        {/* Route line */}
        <Source id="route" type="geojson" data={routeGeoJSON ?? fallbackLine}>
          <Layer
            id="route-line"
            type="line"
            paint={{ "line-color": "#1d4ed8", "line-width": 3, "line-opacity": 0.7, "line-dasharray": [2, 1] }}
          />
        </Source>

        {/* Origin marker */}
        <Marker latitude={originLat} longitude={originLng} anchor="bottom">
          <div className="flex flex-col items-center">
            <div className="w-3 h-3 rounded-full bg-emerald-500 border-2 border-white shadow-md" />
            <div className="text-xs font-bold text-emerald-700 bg-white px-1.5 py-0.5 rounded shadow mt-0.5 whitespace-nowrap">
              Origin
            </div>
          </div>
        </Marker>

        {/* Destination marker */}
        <Marker latitude={destLat} longitude={destLng} anchor="bottom">
          <div className="flex flex-col items-center">
            <div className="w-3 h-3 rounded-full bg-red-500 border-2 border-white shadow-md" />
            <div className="text-xs font-bold text-red-700 bg-white px-1.5 py-0.5 rounded shadow mt-0.5 whitespace-nowrap">
              Destination
            </div>
          </div>
        </Marker>

        {/* Vehicle marker */}
        {currentLocation && (
          <Marker
            latitude={Number(currentLocation.latitude)}
            longitude={Number(currentLocation.longitude)}
            anchor="center"
            rotation={currentLocation.heading ?? 0}
          >
            <div className="w-8 h-8 bg-blue-700 rounded-full border-2 border-white shadow-lg flex items-center justify-center">
              <Navigation className="w-4 h-4 text-white" />
            </div>
          </Marker>
        )}

        {/* Route event markers */}
        {routeEvents.map((event) => {
          const lat = (event.affectedRegion.latMin + event.affectedRegion.latMax) / 2;
          const lng = (event.affectedRegion.lngMin + event.affectedRegion.lngMax) / 2;
          return (
            <Marker key={event.id} latitude={lat} longitude={lng} anchor="center">
              <div className="w-7 h-7 bg-amber-500 rounded-full border-2 border-white shadow-md flex items-center justify-center" title={event.title}>
                <AlertTriangle className="w-3.5 h-3.5 text-white" />
              </div>
            </Marker>
          );
        })}
      </Map>
    </div>
  );
}
