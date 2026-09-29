import { FastifyError, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";
import { AppError } from "../shared/errors";

/**
 * Registered directly on the root Fastify instance via `app.setErrorHandler`
 * in server.ts — NOT via `app.register(...)`. A plain async function passed
 * to `register()` gets its own encapsulation context, so a `setErrorHandler`
 * call inside it would only apply to that context's own children, never to
 * sibling route plugins registered afterward (they'd silently fall back to
 * Fastify's bare default error format instead). Calling it directly on the
 * root instance is what makes it apply to every route in the app.
 */
export function errorHandler(error: FastifyError | Error | unknown, request: FastifyRequest, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.status(400).send({
      success: false,
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: error.issues.map((e) => ({
          field: e.path.join("."),
          message: e.message,
        })),
      },
    });
  }

  if (error instanceof AppError) {
    return reply.status(error.statusCode).send({
      success: false,
      error: { code: error.code ?? "ERROR", message: error.message },
    });
  }

  if (error !== null && typeof error === "object") {
    const e = error as { constructor?: { name?: string }; code?: string; meta?: { target?: string[] } };
    if (e.constructor?.name === "PrismaClientKnownRequestError") {
      if (e.code === "P2002") {
        return reply.status(409).send({
          success: false,
          error: {
            code: "CONFLICT",
            message: `A record with this ${e.meta?.target?.join(", ") ?? "value"} already exists`,
          },
        });
      }
      if (e.code === "P2025") {
        return reply.status(404).send({
          success: false,
          error: { code: "NOT_FOUND", message: "Record not found" },
        });
      }
    }
  }

  request.log.error(error);
  return reply.status(500).send({
    success: false,
    error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" },
  });
}
