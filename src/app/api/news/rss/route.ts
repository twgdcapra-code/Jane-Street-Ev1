import { NextResponse } from "next/server";

/**
 * RSS / Atom / JSON Feed proxy.
 *
 * Browsers can't fetch cross-origin RSS directly due to CORS. This route
 * fetches the upstream feed server-side and returns it to the client.
 *
 * GET /api/news/rss?url=<feed-url>
 *
 * The proxy:
 *   - Adds a realistic User-Agent (some feeds 403 the default fetch UA)
 *   - Streams the body back unchanged (XML or JSON)
 *   - Preserves the upstream Content-Type so the client can parse correctly
 *   - Caps the response at 1MB to avoid runaway payloads
 *   - Times out after 8s so a slow feed can't hang the UI
 */
export async function GET(req: Request) {
  const url = new URL(req.url).searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "Missing url parameter" }, { status: 400 });
  }
  // Only allow http/https URLs.
  if (!/^https?:\/\//i.test(url)) {
    return NextResponse.json({ error: "Invalid url scheme" }, { status: 400 });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const upstream = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Reuters / FT / WSJ reject the default Node fetch UA. Pretend to be
        // a real feed reader so they return the actual RSS.
        "User-Agent":
          "Mozilla/5.0 (compatible; TWG-Terminal/1.0; +https://github.com/twgdcapra-code/Jane-Street-Ev1) FeedFetcher",
        Accept:
          "application/rss+xml, application/atom+xml, application/xml, text/xml, application/json, text/html",
        "Accept-Language": "en-US,en;q=0.9",
      },
      redirect: "follow",
    });

    if (!upstream.ok) {
      return NextResponse.json(
        { error: `Upstream ${upstream.status} ${upstream.statusText}` },
        { status: 502 },
      );
    }

    const contentType = upstream.headers.get("content-type") ?? "application/xml";
    // Read as text and cap at 1MB. Some feeds include huge embedded CDATA.
    const text = await upstream.text();
    const capped = text.length > 1_048_576 ? text.slice(0, 1_048_576) : text;

    return new NextResponse(capped, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
        "X-Proxied-By": "twg-terminal",
      },
    });
  } catch (err: any) {
    if (err?.name === "AbortError") {
      return NextResponse.json({ error: "Upstream timeout" }, { status: 504 });
    }
    return NextResponse.json(
      { error: err?.message ?? "Fetch failed" },
      { status: 502 },
    );
  } finally {
    clearTimeout(timeout);
  }
}
