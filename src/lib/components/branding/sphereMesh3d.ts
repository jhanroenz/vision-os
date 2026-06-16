export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface SphereMesh {
  vertices: Vec3[];
  edges: Array<[number, number]>;
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

export function rotateX(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c };
}

export function rotateY(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

export function rotateZ(v: Vec3, angle: number): Vec3 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c, z: v.z };
}

/** Latitude/longitude wireframe on a unit sphere. */
export function createSphereWireframe(latBands = 8, lonBands = 14): SphereMesh {
  const vertices: Vec3[] = [];
  const index = (lat: number, lon: number) => lat * lonBands + (lon % lonBands);

  for (let lat = 0; lat <= latBands; lat++) {
    const v = lat / latBands;
    const theta = v * Math.PI;
    const y = Math.cos(theta);
    const ringR = Math.sin(theta);

    for (let lon = 0; lon < lonBands; lon++) {
      const phi = (lon / lonBands) * Math.PI * 2;
      vertices.push(
        normalize({
          x: ringR * Math.cos(phi),
          y,
          z: ringR * Math.sin(phi)
        })
      );
    }
  }

  const edgeSet = new Set<string>();
  const edges: Array<[number, number]> = [];

  function addEdge(a: number, b: number) {
    if (a === b) return;
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    if (edgeSet.has(key)) return;
    edgeSet.add(key);
    edges.push([a, b]);
  }

  for (let lat = 0; lat <= latBands; lat++) {
    for (let lon = 0; lon < lonBands; lon++) {
      const i = index(lat, lon);
      addEdge(i, index(lat, lon + 1));
      if (lat < latBands) {
        addEdge(i, index(lat + 1, lon));
      }
    }
  }

  return { vertices, edges };
}

export function projectVertex(
  v: Vec3,
  cx: number,
  cy: number,
  radius: number,
  focal = 2.8
): { x: number; y: number; z: number; scale: number } {
  const depth = focal + v.z;
  const scale = focal / Math.max(0.35, depth);
  return {
    x: cx + v.x * radius * scale,
    y: cy + v.y * radius * scale,
    z: v.z,
    scale
  };
}
