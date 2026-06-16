/** Internal ports for packaged VisionOS builds (avoid common dev ports). */
export const PACKAGED_PORTS = {
  backend: 39247,
  searxng: 37583
};

export function packagedSearxngBase(port = PACKAGED_PORTS.searxng) {
  return `http://127.0.0.1:${port}`;
}
