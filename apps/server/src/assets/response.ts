import { sanitizeFilename } from "../platform/values";

/**
 * Assets are served from the same origin as the admin app, so a stored file
 * must never be able to act as a first-party script. `sandbox` drops the
 * response into an opaque origin, which neutralises SVG/HTML script even if a
 * blocked content type somehow reached the bucket, while `img-src data:` keeps
 * ordinary `<img>` embedding working.
 */
const ASSET_CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox";

export interface AssetObjectMeta {
  name: string;
  kind: string;
  contentType: string;
}

/**
 * PDFs and images are what a marketer wants to preview in a tab; everything
 * else (eBooks as epub, slide decks, archives) should land in the downloads
 * folder. RFC 5987 encoding is mandatory - asset names are routinely Japanese
 * and header values are ISO-8859-1.
 */
function contentDisposition(meta: AssetObjectMeta): string {
  const inline = meta.kind === "image" || meta.contentType === "application/pdf";
  const fallback = sanitizeFilename(meta.name);
  return `${inline ? "inline" : "attachment"}; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(meta.name)}`;
}

/**
 * Streams an R2 object as an HTTP response, honouring `Range`, `If-None-Match`
 * and `If-Modified-Since` by handing the request headers straight to R2 -
 * `R2GetOptions` accepts a `Headers` for both `range` and `onlyIf`, so none of
 * that parsing has to be reimplemented here.
 *
 * Returns null when the object is missing so the caller can decide the 404
 * shape (the public route deliberately makes every failure indistinguishable).
 */
export async function serveAssetObject(
  bucket: R2Bucket,
  key: string,
  request: Request,
  meta: AssetObjectMeta,
  cacheControl: string,
  extraHeaders?: Record<string, string>,
): Promise<Response | null> {
  const object = await bucket.get(key, {
    range: request.headers,
    onlyIf: request.headers,
  });
  if (object === null) return null;

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  if (!headers.has("content-type")) headers.set("content-type", meta.contentType);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", cacheControl);
  headers.set("content-security-policy", ASSET_CSP);
  headers.set("content-disposition", contentDisposition(meta));
  headers.set("x-content-type-options", "nosniff");
  headers.set("accept-ranges", "bytes");
  for (const [name, value] of Object.entries(extraHeaders ?? {})) headers.set(name, value);

  // A conditional request that matched yields an R2Object with no body.
  if (!("body" in object)) return new Response(null, { status: 304, headers });

  const isHead = request.method === "HEAD";
  if (object.range && "offset" in object.range && request.headers.has("range")) {
    const offset = object.range.offset ?? 0;
    const length = object.range.length ?? object.size - offset;
    headers.set("content-range", `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set("content-length", String(length));
    return new Response(isHead ? null : object.body, { status: 206, headers });
  }
  headers.set("content-length", String(object.size));
  return new Response(isHead ? null : object.body, { status: 200, headers });
}
