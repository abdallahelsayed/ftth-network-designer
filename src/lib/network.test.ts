import { describe, expect, it } from "vitest";
import { computeBudget, computeMaterials, distanceM, fiberColor, type Network } from "./network";

const settings = { oltClass: "gpon_b_plus" as const, attenuationDbKm: 0.35, spliceLossDb: 0.1, connectorLossDb: 0.5 };

function network(splitRatio: number): Network {
  return {
    elements: [
      { id: "c", kind: "closure", name: "Closure" },
      { id: "n", kind: "nap", name: "NAP" },
      { id: "k", kind: "customer", name: "Home" },
      { id: "u", kind: "customer", name: "Unwired" },
    ],
    routes: [
      { id: "feed", name: "Feed", kind: "feeder", fiberCount: 12, lengthM: 2000, fromElementId: null, toElementId: "c" },
      { id: "dist", name: "Dist", kind: "distribution", fiberCount: 12, lengthM: 1000, fromElementId: "c", toElementId: "n" },
      { id: "drop", name: "Drop", kind: "drop", fiberCount: 12, lengthM: 100, fromElementId: "n", toElementId: "k" },
    ],
    splitters: [
      { id: "s1", boxId: "c", ratio: splitRatio },
      { id: "s2", boxId: "n", ratio: 2 },
    ],
    connections: [
      { boxId: "c", a: "f:feed:1", b: "si:s1" },
      { boxId: "c", a: "so:s1:1", b: "f:dist:1" },
      { boxId: "n", a: "f:dist:1", b: "si:s2" },
      { boxId: "n", a: "so:s2:1", b: "d:k" },
      { boxId: "n", a: "so:s2:2", b: "f:drop:2" },
    ],
  };
}

describe("fiber colours", () => {
  it("follow the 12-colour order in tubes of 12", () => {
    expect(fiberColor(1).color).toBe("Blue");
    expect(fiberColor(12).color).toBe("Aqua");
    expect(fiberColor(13)).toEqual({ color: "Blue", tube: 2, tubeColor: "Orange" });
  });
});

describe("distance", () => {
  it("is geodesic", () => {
    // One degree of latitude is about 111.2 km.
    expect(distanceM([0, 0], [1, 0])).toBeCloseTo(111_195, -1);
  });
});

describe("power budget", () => {
  it("traces a customer to the feeder and sums the losses", () => {
    const { customers } = computeBudget(network(8), settings);
    const home = customers.find((c) => c.customerId === "k")!;
    // 3.1 km fiber, 3 splices, 3 connectors, 1:8 + 1:2.
    expect(home.splices).toBe(3);
    expect(home.connectors).toBe(3);
    expect(home.totalLossDb).toBeCloseTo(3.1 * 0.35 + 0.3 + 1.5 + 10.5 + 3.7, 2);
    expect(home.verdict).toBe("ok");
    expect(home.rxDbm).toBeCloseTo(1.5 - home.totalLossDb, 1);
  });

  it("flags marginal, over budget and untraced customers", () => {
    expect(computeBudget(network(64), settings).customers[0]!.verdict).toBe("marginal");
    const over = computeBudget(network(64), { ...settings, attenuationDbKm: 1 });
    expect(over.customers[0]!.verdict).toBe("over");
    expect(over.alerts.some((a) => a.kind === "over" && a.subjectId === "k")).toBe(true);
    expect(over.alerts.some((a) => a.kind === "untraced" && a.subjectId === "u")).toBe(true);
  });

  it("reports splitters with no free outputs", () => {
    const { alerts } = computeBudget(network(8), settings);
    expect(alerts.some((a) => a.kind === "full" && a.subjectId === "s2")).toBe(true);
  });
});

describe("materials", () => {
  it("adds overlength and reserves per fiber count", () => {
    const { cables, counts } = computeMaterials(network(8), { overlengthPct: 3, closureReserveM: 30, splitterReserveM: 20 });
    // Feed ends in the closure; Dist starts there; Drop touches none.
    expect(cables).toEqual([{ fiberCount: 12, routes: 3, routeM: 3100, reserveM: 60, totalM: Math.ceil(3100 * 1.03 + 60) }]);
    expect(counts).toContainEqual({ label: "Splitter 1:8", count: 1 });
    expect(counts).toContainEqual({ label: "Customer", count: 2 });
  });
});
