import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
} from "drizzle-orm/sqlite-core";

const createdAt = () =>
  text("created_at")
    .notNull()
    .default(sql`(current_timestamp)`);

// People the Gateway has signed in, keyed by the Gateway's user id.
export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  createdAt: createdAt(),
});

export const projects = sqliteTable(
  "projects",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id").notNull(),
    ownerId: text("owner_id").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    centerLat: real("center_lat").notNull(),
    centerLng: real("center_lng").notNull(),
    oltClass: text("olt_class").notNull().default("gpon_b_plus"),
    attenuationDbKm: real("attenuation_db_km").notNull().default(0.35),
    spliceLossDb: real("splice_loss_db").notNull().default(0.1),
    connectorLossDb: real("connector_loss_db").notNull().default(0.5),
    overlengthPct: real("overlength_pct").notNull().default(3),
    closureReserveM: real("closure_reserve_m").notNull().default(30),
    splitterReserveM: real("splitter_reserve_m").notNull().default(20),
    createdAt: createdAt(),
  },
  (t) => [index("projects_org").on(t.orgId)],
);

// People added to a project by email, with their role there.
export const projectMembers = sqliteTable(
  "project_members",
  {
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role", { enum: ["editor", "viewer"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.email] })],
);

export const layers = sqliteTable(
  "layers",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    visible: integer("visible", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [index("layers_project").on(t.projectId)],
);

export const elements = sqliteTable(
  "elements",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    layerId: text("layer_id")
      .notNull()
      .references(() => layers.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: ["pole", "closure", "nap", "splitter", "customer"],
    }).notNull(),
    name: text("name").notNull(),
    address: text("address").notNull().default(""),
    notes: text("notes").notNull().default(""),
    lat: real("lat").notNull(),
    lng: real("lng").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("elements_project").on(t.projectId)],
);

export const routes = sqliteTable(
  "routes",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    layerId: text("layer_id")
      .notNull()
      .references(() => layers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    fiberCount: integer("fiber_count").notNull(),
    kind: text("kind", { enum: ["feeder", "distribution", "drop"] }).notNull(),
    // [[lat, lng], ...]
    points: text("points", { mode: "json" }).$type<[number, number][]>().notNull(),
    lengthM: real("length_m").notNull(),
    fromElementId: text("from_element_id").references(() => elements.id, {
      onDelete: "set null",
    }),
    toElementId: text("to_element_id").references(() => elements.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("routes_project").on(t.projectId)],
);

// Splitters placed inside a box (closure, NAP or splitter element).
export const splitters = sqliteTable(
  "splitters",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    boxId: text("box_id")
      .notNull()
      .references(() => elements.id, { onDelete: "cascade" }),
    ratio: integer("ratio").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("splitters_project").on(t.projectId)],
);

// One connection between two ports inside a box. Port keys:
// f:<routeId>:<fiber>, si:<splitterId>, so:<splitterId>:<output>, d:<customerId>.
export const connections = sqliteTable(
  "connections",
  {
    id: text("id").primaryKey(),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    boxId: text("box_id")
      .notNull()
      .references(() => elements.id, { onDelete: "cascade" }),
    a: text("a").notNull(),
    b: text("b").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("connections_project").on(t.projectId)],
);

// Each port in a box carries at most one connection: the primary key refuses a second.
export const portUses = sqliteTable(
  "port_uses",
  {
    boxId: text("box_id")
      .notNull()
      .references(() => elements.id, { onDelete: "cascade" }),
    port: text("port").notNull(),
    connectionId: text("connection_id")
      .notNull()
      .references(() => connections.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.boxId, t.port] })],
);
