import { fromWebHandler } from 'h3'
import { handleMediaRequest } from '../../../src/lib/server/media-handler'

// Specific nitro route for /api/media. Required because nitro's dev middleware
// treats Sec-Fetch-Dest: image/video requests as static assets and never
// forwards them to the TanStack Start catch-all — media elements would 404.
// A concrete route in nitro's routing table wins that classification in dev
// and takes precedence over the catch-all in prod.
export default fromWebHandler((request) => handleMediaRequest(request))
