import { createMiddleware } from "@tanstack/react-start";
import { setResponseStatus } from "@tanstack/react-start/server";
import { ForbiddenError, NotFoundError } from "@/server/errors";

/** A refused call answers 404 or 403, not 200 with an error inside. */
export const errorStatusMiddleware = createMiddleware({ type: "function" }).server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error instanceof NotFoundError) setResponseStatus(404);
    else if (error instanceof ForbiddenError) setResponseStatus(403);
    else setResponseStatus(400);
    throw error;
  }
});
