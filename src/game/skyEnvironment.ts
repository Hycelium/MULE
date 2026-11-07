import * as THREE from "three";

/** Zenith matches the scene background, the horizon is haze, the ground matches the hemisphere light's ground color. */
const ZENITH = new THREE.Color(0x7aa0c0);
const HORIZON = new THREE.Color(0xd8dde0);
const GROUND = new THREE.Color(0x5e6e54);

/**
 * A 64 px PMREM of a sky-to-ground gradient, so metallic PBR surfaces reflect something.
 * Keep `scene.environmentIntensity` low: the hemisphere, ambient, and sun lights already carry the diffuse look.
 */
export function buildSkyEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  const geo = new THREE.SphereGeometry(10, 32, 16);
  const pos = geo.getAttribute("position");
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i) / 10;
    if (y >= 0) c.copy(HORIZON).lerp(ZENITH, Math.pow(y, 0.6));
    else c.copy(HORIZON).lerp(GROUND, Math.min(1, -y * 4));
    c.toArray(colors, i * 3);
  }
  geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide });
  const sky = new THREE.Scene();
  sky.add(new THREE.Mesh(geo, mat));

  const pmrem = new THREE.PMREMGenerator(renderer);
  const target = pmrem.fromScene(sky, 0, 0.1, 100, { size: 64 });
  pmrem.dispose();
  geo.dispose();
  mat.dispose();
  return target.texture;
}
