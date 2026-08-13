# ADR 0002 — A single egress gateway is the only outbound network path

**Status:** Proposed · **Ratified at:** Gates G-3 and G-4 · **Relates to:** C21, D7

## Context

`00` and `03` require HTTPS-only outbound requests, explicit domain and redirect
allowlists, DNS and IP validation against SSRF, restricted content size and MIME types,
rate-limit compliance, no general-purpose open proxy behavior, and per-connector
credential separation. `03` §Security states these as properties of the system.

A property enforced in ten connectors is enforced in none of them. The first connector
written under deadline pressure with a direct HTTP client silently voids the policy, and
nothing in the codebase notices.

## Decision

Exactly one component — the **egress gateway**, in its own runtime and network zone —
may open an outbound connection. Every other component is network-isolated and calls:

```
fetch(source_id, url, policy) -> { status, headers, bytes, resolved_url,
                                   redirect_chain, timing, violations[] }
```

The gateway enforces, per source policy: HTTPS only; destination on the source's
allowlist; DNS resolution followed by rejection of private, link-local, and metadata IP
ranges (re-checked at connect time against rebinding); redirect policy; byte and MIME
caps; per-host rate limits and crawl delay; robots posture; and an honest user agent.
It emits the request/response telemetry that Source Health consumes.

The **browser worker** runs inside the same zone, holds no long-lived credentials, is
usable only for explicitly approved sources, and is never a generic fallback. CAPTCHA
solving is never automated; a permitted CAPTCHA is completed by an operator through
Connector Care.

## Alternatives considered

- **A shared HTTP client library with the policy inside it.** Rejected: a library is
  advice. Nothing prevents a second client, and nothing centralizes the audit trail.
- **Network policy at the infrastructure layer only.** Rejected: infrastructure ACLs
  express allowed hosts but not per-source redirect policy, MIME caps, robots posture,
  or license mode — and produce no application-level telemetry.

## Consequences

Good: policy becomes mechanism; SSRF and allowlist violations fail closed and are
logged; per-host rate limiting is globally correct rather than per-connector; HTTP
telemetry for observability is free.

Bad: the gateway is a single point of failure and a throughput chokepoint, so it needs
its own health checks and headroom. Streaming very large documents through it requires
care. Local development needs a gateway stub.

## Revisit when

Never for the policy. The *implementation* may be revisited if a document class needs
streaming semantics the request/response contract cannot express.
