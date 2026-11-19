import { useEffect, useRef } from "react";
import type * as Leaflet from "leaflet";
import type { Plan } from "@/server/projects";
import type { ElementKind, RouteKind } from "@/lib/network";

type El = Plan["elements"][number];
type Rt = Plan["routes"][number];

export const KIND_CLASS: Record<ElementKind, string> = {
  pole: "bg-muted-foreground",
  closure: "bg-chart-1",
  nap: "bg-chart-2",
  splitter: "bg-chart-3",
  customer: "bg-chart-4",
};
const KIND_SHAPE: Record<ElementKind, string> = {
  pole: "rounded-full size-3",
  closure: "rounded-sm size-4",
  nap: "rounded-sm size-4 rotate-45",
  splitter: "rounded-full size-4",
  customer: "rounded-full size-3.5",
};
export const ROUTE_CLASS: Record<RouteKind, string> = {
  feeder: "stroke-chart-1",
  distribution: "stroke-chart-3",
  drop: "stroke-chart-2",
};
const ROUTE_WEIGHT: Record<RouteKind, number> = { feeder: 5, distribution: 4, drop: 2.5 };

export interface MapHandlers {
  onMapClick: (lat: number, lng: number) => void;
  onElementClick: (element: El) => void;
  onRouteClick: (route: Rt) => void;
  onElementMoved: (element: El, lat: number, lng: number) => void;
}

/**
 * The Leaflet map. Leaflet needs the browser, so it loads after the first
 * render; everything drawn on it is redrawn from props.
 */
export function NetworkMap({
  center,
  elements,
  routes,
  draft,
  measure,
  selectedId,
  draggable,
  handlers,
  onReady,
}: {
  center: [number, number];
  elements: El[];
  routes: Rt[];
  draft: [number, number][];
  measure: [number, number][];
  selectedId: string | null;
  draggable: boolean;
  handlers: MapHandlers;
  onReady?: (map: Leaflet.Map) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const state = useRef<{ L: typeof Leaflet; map: Leaflet.Map; group: Leaflet.LayerGroup } | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const props = { elements, routes, draft, measure, selectedId, draggable };
  const propsRef = useRef(props);
  propsRef.current = props;

  function redraw() {
    const s = state.current;
    if (!s) return;
    const { L, group } = s;
    const p = propsRef.current;
    group.clearLayers();
    for (const r of p.routes) {
      const line = L.polyline(r.points, {
        className: `${ROUTE_CLASS[r.kind]}${r.id === p.selectedId ? " opacity-60" : ""}`,
        weight: ROUTE_WEIGHT[r.kind] + (r.id === p.selectedId ? 3 : 0),
        bubblingMouseEvents: false,
      });
      line.on("click", () => handlersRef.current.onRouteClick(r));
      line.bindTooltip(r.name, { sticky: true });
      group.addLayer(line);
    }
    for (const e of p.elements) {
      const ring = e.id === p.selectedId ? " ring-2 ring-ring ring-offset-2 ring-offset-background" : "";
      const icon = L.divIcon({
        className: "",
        html: `<span data-testid="marker" data-kind="${e.kind}" class="block border-2 border-background shadow ${KIND_CLASS[e.kind]} ${KIND_SHAPE[e.kind]}${ring}"></span>`,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });
      // Center the shape inside the 24px hit area.
      const marker = L.marker([e.lat, e.lng], { icon, draggable: p.draggable, title: e.name, keyboard: false });
      marker.on("click", () => handlersRef.current.onElementClick(e));
      marker.on("dragend", () => {
        const at = marker.getLatLng();
        handlersRef.current.onElementMoved(e, at.lat, at.lng);
      });
      group.addLayer(marker);
    }
    if (p.draft.length) {
      group.addLayer(L.polyline(p.draft, { className: "stroke-primary", weight: 3, dashArray: "6 6", interactive: false }));
      for (const pt of p.draft) group.addLayer(L.circleMarker(pt, { radius: 4, className: "stroke-primary fill-background", interactive: false }));
    }
    if (p.measure.length) {
      group.addLayer(L.polyline(p.measure, { className: "stroke-foreground", weight: 2, dashArray: "2 6", interactive: false }));
      for (const pt of p.measure) group.addLayer(L.circleMarker(pt, { radius: 3, className: "stroke-foreground fill-background", interactive: false }));
    }
  }

  useEffect(() => {
    let cancelled = false;
    void import("leaflet").then((mod) => {
      const L = (mod.default ?? mod) as typeof Leaflet;
      if (cancelled || !container.current) return;
      const map = L.map(container.current, { center, zoom: 16, doubleClickZoom: false, zoomControl: true });
      L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        crossOrigin: "anonymous",
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      }).addTo(map);
      const group = L.layerGroup().addTo(map);
      map.on("click", (e: Leaflet.LeafletMouseEvent) => handlersRef.current.onMapClick(e.latlng.lat, e.latlng.lng));
      state.current = { L, map, group };
      redraw();
      onReady?.(map);
    });
    return () => {
      cancelled = true;
      state.current?.map.remove();
      state.current = null;
    };
    // The map is made once; its contents follow the props below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(redraw, [elements, routes, draft, measure, selectedId, draggable]);

  return (
    <div
      ref={container}
      data-testid="map"
      className="isolate z-0 h-[65vh] min-h-[420px] w-full overflow-hidden rounded-lg border border-border bg-muted"
    />
  );
}

/** Draws the current view, tiles when the browser allows it, then the network, into a PNG. */
export async function exportMapPng(map: Leaflet.Map, elements: El[], routes: Rt[], fileName: string) {
  const size = map.getSize();
  const scale = window.devicePixelRatio || 1;
  const canvas = document.createElement("canvas");
  canvas.width = size.x * scale;
  canvas.height = size.y * scale;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(scale, scale);
  const css = getComputedStyle(document.documentElement);
  const token = (name: string) => css.getPropertyValue(name).trim() || "gray";
  const box = map.getContainer().getBoundingClientRect();

  function drawNetwork(withTiles: boolean) {
    ctx.fillStyle = token("--muted");
    ctx.fillRect(0, 0, size.x, size.y);
    if (withTiles) {
      map.getContainer().querySelectorAll<HTMLImageElement>("img.leaflet-tile-loaded").forEach((img) => {
        const r = img.getBoundingClientRect();
        ctx.drawImage(img, r.left - box.left, r.top - box.top, r.width, r.height);
      });
    }
    const routeColor: Record<string, string> = { feeder: token("--chart-1"), distribution: token("--chart-3"), drop: token("--chart-2") };
    for (const r of routes) {
      ctx.strokeStyle = routeColor[r.kind]!;
      ctx.lineWidth = ROUTE_WEIGHT[r.kind];
      ctx.lineCap = "round";
      ctx.beginPath();
      r.points.forEach((pt, i) => {
        const p = map.latLngToContainerPoint(pt);
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.stroke();
    }
    const kindColor: Record<string, string> = {
      pole: token("--muted-foreground"), closure: token("--chart-1"), nap: token("--chart-2"), splitter: token("--chart-3"), customer: token("--chart-4"),
    };
    ctx.font = "12px system-ui, sans-serif";
    for (const e of elements) {
      const p = map.latLngToContainerPoint([e.lat, e.lng]);
      ctx.fillStyle = kindColor[e.kind]!;
      ctx.strokeStyle = token("--background");
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = token("--foreground");
      ctx.fillText(e.name, p.x + 10, p.y + 4);
    }
  }

  const toBlob = () => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  let blob: Blob | null = null;
  try {
    drawNetwork(true);
    blob = await toBlob();
  } catch {
    blob = null;
  }
  if (!blob) {
    drawNetwork(false);
    blob = await toBlob();
  }
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
