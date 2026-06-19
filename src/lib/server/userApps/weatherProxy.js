const ALLOWED_HOSTS = new Set([
  "geocoding-api.open-meteo.com",
  "api.open-meteo.com",
  "nominatim.openstreetmap.org",
]);

export async function proxyWeatherFetch(targetUrl) {
  let url;
  try {
    url = new URL(String(targetUrl));
  } catch {
    throw new Error("Invalid URL");
  }

  if (url.protocol !== "https:") {
    throw new Error("Only HTTPS URLs are allowed");
  }

  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(`Host not allowed: ${url.hostname}`);
  }

  const headers = {};
  if (url.hostname === "nominatim.openstreetmap.org") {
    headers["User-Agent"] = "WeatherForecast/1.0 (VisionOS)";
    headers.Accept = "application/json";
  }

  const response = await fetch(url.toString(), { headers });
  const body = await response.text();

  return new Response(body, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json",
      "Cache-Control": "no-cache",
    },
  });
}
