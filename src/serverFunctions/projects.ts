import { createServerFn } from "@tanstack/react-start";
import { ensureUserMiddleware } from "@every-app/sdk/tanstack-start";
import { NotFoundError, actorOf } from "@/server/access";
import { errorStatusMiddleware } from "@/serverFunctions/errorStatus";
import * as projects from "@/server/projects";
import * as map from "@/server/map";
import * as diagram from "@/server/diagram";


export const getProjects = createServerFn()
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .handler(({ context }) => projects.listProjects(actorOf(context.user)));

/** The whole plan, or null when the project doesn't exist for this person. */
export const getPlan = createServerFn()
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => projects.projectIdInput.parse(data))
  .handler(async ({ data, context }) => {
    try {
      return await projects.loadPlan(actorOf(context.user), data.projectId);
    } catch (error) {
      if (error instanceof NotFoundError) return null;
      throw error;
    }
  });

export const createProject = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => projects.createProjectInput.parse(data))
  .handler(({ data, context }) => projects.createProject(actorOf(context.user), data));
export const updateProject = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => projects.updateProjectInput.parse(data))
  .handler(({ data, context }) => projects.updateProject(actorOf(context.user), data));
export const updateSettings = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => projects.updateSettingsInput.parse(data))
  .handler(({ data, context }) => projects.updateSettings(actorOf(context.user), data));
export const deleteProject = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => projects.projectIdInput.parse(data))
  .handler(({ data, context }) => projects.deleteProject(actorOf(context.user), data));
export const addMember = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => projects.memberInput.parse(data))
  .handler(({ data, context }) => projects.addMember(actorOf(context.user), data));
export const removeMember = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => projects.removeMemberInput.parse(data))
  .handler(({ data, context }) => projects.removeMember(actorOf(context.user), data));

export const createLayer = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => map.layerCreateInput.parse(data))
  .handler(({ data, context }) => map.createLayer(actorOf(context.user), data));
export const updateLayer = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => map.layerUpdateInput.parse(data))
  .handler(({ data, context }) => map.updateLayer(actorOf(context.user), data));
export const createElement = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => map.elementCreateInput.parse(data))
  .handler(({ data, context }) => map.createElement(actorOf(context.user), data));
export const updateElement = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => map.elementUpdateInput.parse(data))
  .handler(({ data, context }) => map.updateElement(actorOf(context.user), data));
export const deleteElement = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => map.elementDeleteInput.parse(data))
  .handler(({ data, context }) => map.deleteElement(actorOf(context.user), data));
export const createRoute = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => map.routeCreateInput.parse(data))
  .handler(({ data, context }) => map.createRoute(actorOf(context.user), data));
export const updateRoute = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => map.routeUpdateInput.parse(data))
  .handler(({ data, context }) => map.updateRoute(actorOf(context.user), data));
export const deleteRoute = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => map.routeDeleteInput.parse(data))
  .handler(({ data, context }) => map.deleteRoute(actorOf(context.user), data));

export const addSplitter = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => diagram.splitterAddInput.parse(data))
  .handler(({ data, context }) => diagram.addSplitter(actorOf(context.user), data));
export const removeSplitter = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => diagram.splitterRemoveInput.parse(data))
  .handler(({ data, context }) => diagram.removeSplitter(actorOf(context.user), data));
export const connectPorts = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => diagram.connectInput.parse(data))
  .handler(({ data, context }) => diagram.connect(actorOf(context.user), data));
export const disconnectPorts = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => diagram.disconnectInput.parse(data))
  .handler(({ data, context }) => diagram.disconnect(actorOf(context.user), data));
export const autoConnect = createServerFn({ method: "POST" })
  .middleware([ensureUserMiddleware, errorStatusMiddleware])
  .validator((data: unknown) => diagram.autoConnectInput.parse(data))
  .handler(({ data, context }) => diagram.autoConnect(actorOf(context.user), data));
