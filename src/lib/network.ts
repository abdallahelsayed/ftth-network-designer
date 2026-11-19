// Pure network maths shared by the server, the pages and the tests.

export const ELEMENT_KINDS = ["pole", "closure", "nap", "splitter", "customer"] as const;
export type ElementKind = (typeof ELEMENT_KINDS)[number];
export const BOX_KINDS: ElementKind[] = ["closure", "nap", "splitter"];
export const ELEMENT_LABELS: Record<ElementKind, string> = {
  pole: "Pole",
  closure: "Splice closure",
  nap: "NAP",
  splitter: "Splitter box",
  customer: "Customer",
};

export const FIBER_COUNTS = [12, 24, 48, 96, 144] as const;
export const ROUTE_KINDS = ["feeder", "distribution", "drop"] as const;
export type RouteKind = (typeof ROUTE_KINDS)[number];
export const ROUTE_LABELS: Record<RouteKind, string> = {
  feeder: "Feeder",
  distribution: "Distribution",
  drop: "Drop",
};

export const SPLITTER_RATIOS = [2, 4, 8, 16, 32, 64] as const;
/** Typical insertion loss of a PLC splitter, in dB. */
export const SPLITTER_LOSS_DB: Record<number, number> = {
  2: 3.7,
  4: 7.3,
  8: 10.5,
  16: 13.7,
  32: 17.1,
  64: 20.5,
};

/** The 12 fiber colours, in standard order. */
export const FIBER_COLORS = [
  "Blue", "Orange", "Green", "Brown", "Slate", "White",
  "Red", "Black", "Yellow", "Violet", "Rose", "Aqua",
] as const;

/** Fiber n (1-based): its colour and the tube it sits in (tubes of 12). */
export function fiberColor(n: number) {
  return {
    color: FIBER_COLORS[(n - 1) % 12]!,
    tube: Math.floor((n - 1) / 12) + 1,
    tubeColor: FIBER_COLORS[Math.floor((n - 1) / 12) % 12]!,
  };
}

export const OLT_CLASSES = {
  gpon_b_plus: { label: "GPON B+", maxLossDb: 28, txDbm: 1.5 },
  gpon_c_plus: { label: "GPON C+", maxLossDb: 32, txDbm: 3 },
  xgspon_n1: { label: "XGS-PON N1", maxLossDb: 29, txDbm: 2 },
  xgspon_n2: { label: "XGS-PON N2", maxLossDb: 31, txDbm: 4 },
  xgspon_e1: { label: "XGS-PON E1", maxLossDb: 33, txDbm: 6 },
  xgspon_e2: { label: "XGS-PON E2", maxLossDb: 35, txDbm: 8 },
} as const;
export type OltClass = keyof typeof OLT_CLASSES;
export const OLT_CLASS_IDS = Object.keys(OLT_CLASSES) as OltClass[];

/** Below this margin a customer is marginal. */
export const MARGINAL_DB = 3;

const EARTH_RADIUS_M = 6_371_008.8;

/** Great-circle distance in meters. */
export function distanceM(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad;
  const dLng = (b[1] - a[1]) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function pathLengthM(points: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) total += distanceM(points[i - 1]!, points[i]!);
  return total;
}

// Ports ----------------------------------------------------------------

export type Port =
  | { type: "f"; routeId: string; fiber: number }
  | { type: "si"; splitterId: string }
  | { type: "so"; splitterId: string; output: number }
  | { type: "d"; customerId: string };

export function parsePort(key: string): Port | null {
  const [type, id, n] = key.split(":");
  if (!id) return null;
  if (type === "f" && n) return { type, routeId: id, fiber: Number(n) };
  if (type === "si" && n === undefined) return { type, splitterId: id };
  if (type === "so" && n) return { type, splitterId: id, output: Number(n) };
  if (type === "d" && n === undefined) return { type, customerId: id };
  return null;
}

// Budget ---------------------------------------------------------------

export interface NetElement { id: string; kind: ElementKind; name: string }
export interface NetRoute {
  id: string;
  name: string;
  kind: RouteKind;
  fiberCount: number;
  lengthM: number;
  fromElementId: string | null;
  toElementId: string | null;
}
export interface NetSplitter { id: string; boxId: string; ratio: number }
export interface NetConnection { boxId: string; a: string; b: string }
export interface BudgetSettings {
  oltClass: OltClass;
  attenuationDbKm: number;
  spliceLossDb: number;
  connectorLossDb: number;
}
export interface Network {
  elements: NetElement[];
  routes: NetRoute[];
  splitters: NetSplitter[];
  connections: NetConnection[];
}

export type Verdict = "ok" | "marginal" | "over" | "untraced";

export interface CustomerBudget {
  customerId: string;
  name: string;
  verdict: Verdict;
  lengthM: number;
  splices: number;
  connectors: number;
  splitterLossDb: number;
  totalLossDb: number;
  rxDbm: number | null;
  marginDb: number | null;
  /** Box names from the customer back towards the OLT. */
  path: string[];
}

export interface BudgetAlert {
  kind: "over" | "untraced" | "full";
  subjectId: string;
  message: string;
}

/** The other end of a connection on this port in this box. */
function linkedPort(net: Network, boxId: string, port: string): string | null {
  for (const c of net.connections) {
    if (c.boxId !== boxId) continue;
    if (c.a === port) return c.b;
    if (c.b === port) return c.a;
  }
  return null;
}

function round(n: number, digits = 2) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

/**
 * Traces each customer's drop back to the feeder: through splitters and
 * splices box by box, until a feeder fiber whose far end is not spliced
 * onwards (the OLT side). Each fiber joint counts as a splice; the OLT and
 * ONU connectors plus each customer drop count as connectors.
 */
export function computeBudget(net: Network, s: BudgetSettings) {
  const olt = OLT_CLASSES[s.oltClass] ?? OLT_CLASSES.gpon_b_plus;
  const byId = new Map(net.elements.map((e) => [e.id, e]));
  const routesById = new Map(net.routes.map((r) => [r.id, r]));
  const splittersById = new Map(net.splitters.map((sp) => [sp.id, sp]));
  const customers: CustomerBudget[] = [];

  for (const customer of net.elements.filter((e) => e.kind === "customer")) {
    const drop = `d:${customer.id}`;
    const at = net.connections.find((c) => c.a === drop || c.b === drop);
    let lengthM = 0;
    let splices = 0;
    let connectors = 2;
    let splitterLossDb = 0;
    const path: string[] = [];
    let traced = false;
    if (at) {
      // The drop cable to the customer, when one is drawn.
      const dropCable = net.routes.find(
        (r) =>
          (r.fromElementId === at.boxId && r.toElementId === customer.id) ||
          (r.toElementId === at.boxId && r.fromElementId === customer.id),
      );
      if (dropCable) lengthM += dropCable.lengthM;
      connectors += 1;
      let boxId = at.boxId;
      let port: string | null = at.a === drop ? at.b : at.a;
      for (let guard = 0; port && guard < 500; guard++) {
        path.push(byId.get(boxId)?.name ?? "?");
        const p = parsePort(port);
        if (!p) break;
        if (p.type === "so") {
          const sp = splittersById.get(p.splitterId);
          if (!sp) break;
          splitterLossDb += SPLITTER_LOSS_DB[sp.ratio] ?? 0;
          port = linkedPort(net, boxId, `si:${sp.id}`);
          if (port?.startsWith("f:")) splices += 1;
          path.pop();
          continue;
        }
        if (p.type === "f") {
          const r = routesById.get(p.routeId);
          if (!r) break;
          lengthM += r.lengthM;
          const far = r.fromElementId === boxId ? r.toElementId : r.fromElementId;
          const farBox = far ? byId.get(far) : undefined;
          const onward: string | null = farBox ? linkedPort(net, farBox.id, port) : null;
          if (!onward) {
            traced = r.kind === "feeder";
            break;
          }
          splices += 1;
          boxId = farBox!.id;
          port = onward;
          continue;
        }
        break;
      }
    }
    if (!traced) {
      customers.push({
        customerId: customer.id, name: customer.name, verdict: "untraced",
        lengthM: round(lengthM, 1), splices, connectors, splitterLossDb: round(splitterLossDb),
        totalLossDb: 0, rxDbm: null, marginDb: null, path,
      });
      continue;
    }
    const total =
      (lengthM / 1000) * s.attenuationDbKm +
      splices * s.spliceLossDb +
      connectors * s.connectorLossDb +
      splitterLossDb;
    const margin = olt.maxLossDb - total;
    customers.push({
      customerId: customer.id,
      name: customer.name,
      verdict: margin < 0 ? "over" : margin < MARGINAL_DB ? "marginal" : "ok",
      lengthM: round(lengthM, 1),
      splices,
      connectors,
      splitterLossDb: round(splitterLossDb),
      totalLossDb: round(total),
      rxDbm: round(olt.txDbm - total),
      marginDb: round(margin),
      path,
    });
  }

  const alerts: BudgetAlert[] = [];
  for (const c of customers) {
    if (c.verdict === "over")
      alerts.push({ kind: "over", subjectId: c.customerId, message: `${c.name} is ${Math.abs(c.marginDb!).toFixed(2)} dB over budget` });
    if (c.verdict === "untraced")
      alerts.push({ kind: "untraced", subjectId: c.customerId, message: `${c.name} has no traced path to the feeder` });
  }
  const used = new Set<string>();
  for (const c of net.connections) {
    used.add(`${c.boxId}|${c.a}`);
    used.add(`${c.boxId}|${c.b}`);
  }
  for (const sp of net.splitters) {
    const free = Array.from({ length: sp.ratio }, (_, i) => i + 1).some((o) => !used.has(`${sp.boxId}|so:${sp.id}:${o}`));
    if (!free) alerts.push({ kind: "full", subjectId: sp.id, message: `Splitter 1:${sp.ratio} in ${byId.get(sp.boxId)?.name ?? "a box"} has no free outputs` });
  }
  for (const box of net.elements.filter((e) => BOX_KINDS.includes(e.kind))) {
    const cables = net.routes.filter((r) => r.fromElementId === box.id || r.toElementId === box.id);
    const boxSplitters = net.splitters.filter((sp) => sp.boxId === box.id);
    if (cables.length === 0 && boxSplitters.length === 0) continue;
    const anyFree =
      cables.some((r) => Array.from({ length: r.fiberCount }, (_, i) => i + 1).some((f) => !used.has(`${box.id}|f:${r.id}:${f}`))) ||
      boxSplitters.some((sp) => Array.from({ length: sp.ratio }, (_, i) => i + 1).some((o) => !used.has(`${box.id}|so:${sp.id}:${o}`)));
    if (!anyFree) alerts.push({ kind: "full", subjectId: box.id, message: `${box.name} has no free ports` });
  }
  return { olt: { id: s.oltClass, ...olt }, customers, alerts };
}

// Materials ------------------------------------------------------------

export interface MaterialSettings {
  overlengthPct: number;
  closureReserveM: number;
  splitterReserveM: number;
}

/**
 * Cable to buy per fiber count: route lengths plus the overlength
 * percentage, plus a reserve loop at each cable end in a splice closure or
 * a splitter box.
 */
export function computeMaterials(net: Network, s: MaterialSettings) {
  const byId = new Map(net.elements.map((e) => [e.id, e]));
  const cables = new Map<number, { fiberCount: number; routes: number; routeM: number; reserveM: number; totalM: number }>();
  for (const r of net.routes) {
    const row = cables.get(r.fiberCount) ?? { fiberCount: r.fiberCount, routes: 0, routeM: 0, reserveM: 0, totalM: 0 };
    row.routes += 1;
    row.routeM += r.lengthM;
    for (const end of [r.fromElementId, r.toElementId]) {
      const kind = end ? byId.get(end)?.kind : undefined;
      if (kind === "closure") row.reserveM += s.closureReserveM;
      if (kind === "splitter") row.reserveM += s.splitterReserveM;
    }
    cables.set(r.fiberCount, row);
  }
  const cableRows = [...cables.values()]
    .sort((a, b) => a.fiberCount - b.fiberCount)
    .map((row) => ({
      ...row,
      routeM: round(row.routeM, 1),
      totalM: Math.ceil(row.routeM * (1 + s.overlengthPct / 100) + row.reserveM),
    }));
  const counts: { label: string; count: number }[] = [];
  for (const kind of ELEMENT_KINDS) {
    const n = net.elements.filter((e) => e.kind === kind).length;
    if (n) counts.push({ label: ELEMENT_LABELS[kind], count: n });
  }
  for (const ratio of SPLITTER_RATIOS) {
    const n = net.splitters.filter((sp) => sp.ratio === ratio).length;
    if (n) counts.push({ label: `Splitter 1:${ratio}`, count: n });
  }
  return { cables: cableRows, counts };
}
