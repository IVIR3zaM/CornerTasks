// PUBLIC_URL handling for the self-hosted runtime (D1 in
// plan/v0.3.0/decisions.md, docs/ARCHITECTURE.md "The audience caveat").
//
// `lib/api-url.ts` in backend/core computes the DID-Auth "audience" as
// `https://${requestContext.domainName}/${requestContext.stage}` from the
// HttpEvent — that function is unmodified here. What this module does is
// choose `domainName`/`stage` so that reconstructed string is exactly
// `new URL(PUBLIC_URL).href`, and does so *once*, from `.env`, rather than
// from the inbound request's Host header. That is what makes the audience
// survive an ngrok URL rotation (update `PUBLIC_URL`, restart) instead of
// silently tracking whatever host the request happened to arrive on — which
// would defeat the misconfiguration guard `BackendPing` and `lib/auth.ts`
// both rely on.

export interface PublicAudience {
  /** Feeds `HttpEvent.requestContext.domainName`. */
  domainName: string;
  /** Feeds `HttpEvent.requestContext.stage`. May be `""`. */
  stage: string;
  /** The exact string `audienceFromEvent()` will produce once `domainName`/
   *  `stage` above are used to build the event — i.e. `new URL(PUBLIC_URL).href`. */
  audience: string;
}

/** Parses `PUBLIC_URL` into the `domainName`/`stage` pair that reconstructs
 *  it through `audienceFromEvent()`. Returns `null` if `PUBLIC_URL` is unset.
 *  Throws on a malformed or non-`https://` value — never silently falls back,
 *  matching the "fail loudly" rule N06 sets for the signing key. */
export function readPublicAudience(env: NodeJS.ProcessEnv = process.env): PublicAudience | null {
  const raw = env.PUBLIC_URL;
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`PUBLIC_URL is not a valid absolute URL: "${raw}" (expected e.g. https://example.ngrok.app)`);
  }
  if (url.protocol !== 'https:') {
    throw new Error(
      `PUBLIC_URL must use https:// (got "${url.protocol}"). audienceFromEvent() always emits an ` +
      `https:// audience, so an http:// PUBLIC_URL would silently never match the DID-Auth aud claim.`
    );
  }
  if (url.search || url.hash) {
    throw new Error(`PUBLIC_URL must not include a query string or fragment: "${raw}"`);
  }

  // `https://${domainName}/${stage}` (see lib/api-url.ts) reconstructs
  // `url.href` exactly: domainName is the host, stage is the path with its
  // leading slash stripped (empty string when PUBLIC_URL has no path, which
  // `URL` normalizes to "/" — `https://host/` === `new URL('https://host').href`).
  const domainName = url.host;
  const stage = url.pathname.replace(/^\//, '');
  return { domainName, stage, audience: url.href };
}

/** `PUBLIC_URL` is required whenever the resolved store is `sqlite` — the
 *  self-hosted runtime `backend/server` targets (see D1). Other `CT_STORE`
 *  values aren't served by this runtime at all (see `lib/bootstrap.ts`), but
 *  the check is written against `CT_STORE` rather than assuming sqlite so it
 *  stays correct if that changes. Fails fast at startup with a clear message
 *  rather than deferring to a confusing per-request audience mismatch. */
export function requirePublicAudienceForStore(env: NodeJS.ProcessEnv = process.env): PublicAudience | null {
  const storeKind = env.CT_STORE ?? 'sqlite';
  const publicAudience = readPublicAudience(env);
  if (!publicAudience && storeKind === 'sqlite') {
    throw new Error(
      'PUBLIC_URL is required when CT_STORE=sqlite. Set it to this deployment\'s canonical, ' +
      'publicly reachable base URL (e.g. PUBLIC_URL=https://your-tunnel.ngrok.app) — see ' +
      '"The audience caveat" in docs/ARCHITECTURE.md.'
    );
  }
  return publicAudience;
}
