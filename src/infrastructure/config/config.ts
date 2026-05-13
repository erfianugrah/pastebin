// Worker configuration.
//
// Was previously a 6-section nested config object. The only field anything
// actually consumed was `application.baseUrl` (in `index.ts`), so we now
// expose a single helper. If new global configuration is needed later, add
// it as a discrete export rather than reviving the old kitchen-sink type.

/** Returns the application base URL given a request URL. Today this is
 *  always `url.origin`; centralising it keeps the option open for stripping
 *  trailing slashes / forcing https / etc. without touching call sites.
 */
export function getApplicationBaseUrl(requestUrl: string | URL): string {
	const u = typeof requestUrl === 'string' ? new URL(requestUrl) : requestUrl;
	return u.origin;
}
