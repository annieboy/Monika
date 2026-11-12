/**
 * In-memory per-user rate limiter for AI agent calls.
 *
 * The structured intent handlers (balance, known queries) are cheap and
 * deterministic, but the agentic handler makes paid LLM tool calls. This caps
 * how often a single user can trigger the agent so that chatty conversations,
 * a client retry loop, or abuse can't quietly run up the Anthropic bill.
 *
 * Deliberately generous: normal testing/use won't come close. Single-replica
 * in-memory state is fine here — a soft cap that resets on redeploy is exactly
 * the right strength for a guardrail (it is not a security control).
 */

const WINDOW_MS = 5 * 60 * 1000 // 5 minutes
const MAX_CALLS = 20 // per user per window

const calls = new Map<string, number[]>()

/**
 * Records an agent call for the user and returns whether it is allowed.
 * Returns false once the user exceeds MAX_CALLS within WINDOW_MS.
 */
export function allowAgentCall(userId: string, now: number = Date.now()): boolean {
  const cutoff = now - WINDOW_MS
  const recent = (calls.get(userId) ?? []).filter((t) => t > cutoff)

  if (recent.length >= MAX_CALLS) {
    calls.set(userId, recent) // keep pruned history
    return false
  }

  recent.push(now)
  calls.set(userId, recent)
  return true
}

/** Test helper: clears all recorded calls. */
export function _resetRateLimiter(): void {
  calls.clear()
}

export const AGENT_RATE_LIMIT = { WINDOW_MS, MAX_CALLS }
