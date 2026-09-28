import { NextResponse } from 'next/server';

/**
 * Server-side proxy for Google Places API (New) `searchText`.
 *
 * Why a proxy instead of calling `places.googleapis.com` from the browser:
 * the API key is website-restricted (HTTP referrer), and the Places endpoint
 * rejects the `Referer` browsers send with `fetch` from localhost/tunnels.
 * From the server the request carries no browser referrer, so the same key
 * that renders the map also authorises search — and the key never needs wider
 * restrictions. The body is rebuilt allowlist-style so the key cannot be
 * abused as an open relay.
 */
export async function POST(request: Request) {
  const key = process.env.GOOGLE_MAPS_API_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!key) {
    return NextResponse.json({ error: 'Places API key is not configured.' }, { status: 503 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  if (typeof payload !== 'object' || payload === null) {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }
  const { textQuery, latitude, longitude } = payload as {
    textQuery?: unknown;
    latitude?: unknown;
    longitude?: unknown;
  };
  if (typeof textQuery !== 'string' || textQuery.trim().length === 0 || textQuery.length > 200) {
    return NextResponse.json({ error: 'textQuery must be a non-empty string.' }, { status: 400 });
  }

  const body: Record<string, unknown> = {
    textQuery: textQuery.trim(),
    pageSize: 6,
    languageCode: 'en',
  };
  if (typeof latitude === 'number' && typeof longitude === 'number' &&
      Number.isFinite(latitude) && Number.isFinite(longitude) &&
      Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) {
    body.locationBias = {
      circle: { center: { latitude, longitude }, radius: 50000.0 },
    };
  }

  const upstream = await fetch('https://places.googleapis.com/v1/places:searchText', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': key,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(8000),
  });

  if (upstream.status === 403 || upstream.status === 400) {
    return NextResponse.json(
      { error: 'Places API (New) is not enabled for this key.', configError: true },
      { status: 502 },
    );
  }
  if (!upstream.ok) {
    return NextResponse.json(
      { error: `Places search failed (${upstream.status}).` },
      { status: 502 },
    );
  }
  return NextResponse.json(await upstream.json());
}
