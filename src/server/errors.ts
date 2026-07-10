/** Typed service errors, mapped to HTTP statuses in routes.ts (400/404/409). */
export class ValidationError extends Error {}
export class NotFoundError extends Error {}
export class ConflictError extends Error {}
