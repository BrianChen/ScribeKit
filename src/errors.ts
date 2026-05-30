/**
 * Thrown when the ScribeKit pipeline fails due to an infrastructure error
 * (e.g. rate limit, authentication failure, network error).
 *
 * `cause` holds the original provider error. Two possible shapes:
 *
 * Provider error (e.g. Anthropic rate limit, auth failure, network error):
 *   cause.status     — HTTP status code (429, 401, 500, etc.)
 *   cause.type       — error type string ("rate_limit_error", "authentication_error", etc.)
 *   cause.message    — human-readable error message
 *   cause.error      — raw JSON body ({ type, message })
 *   cause.requestID  — request ID for support tickets
 *   cause.headers    — HTTP response headers
 *   cause.name       — SDK class name ("RateLimitError", "BadRequestError", etc.)
 *
 * Fields vary by provider when additional LLM providers are added.
 * OpenAI exposes the same core fields plus `code` and `param`.
 *
 * LangGraph internal error (graph misconfiguration, recursion limit — indicates a ScribeKit bug):
 *   cause.name          — error class ("GraphRecursionError", "InvalidUpdateError", etc.)
 *   cause.message       — error message
 *   cause.lc_error_code — LangGraph troubleshooting code
 */
export class ScribeKitError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "ScribeKitError";
  }
}
