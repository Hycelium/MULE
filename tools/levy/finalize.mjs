// Wires external textures into M_Levy, writes levy.anim.json, packs levy.glb (meshopt, textures external).
// Usage: node tools/levy/finalize.mjs  (after build_levy.py wrote tools/levy/out)
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SRC = "tools/levy/out";
const DST = "public/models/levy";
const TEX = ["T_Levy_BaseColor.png", "T_Levy_Normal.png", "T_Levy_ORM.png"];

mkdirSync(DST, { recursive: true });
const g = JSON.parse(readFileSync(join(SRC, "levy_src.gltf"), "utf8"));
g.images = TEX.map((uri) => ({ uri }));
g.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 33071, wrapT: 33071 }];
g.textures = TEX.map((_, i) => ({ sampler: 0, source: i }));
const m = g.materials.find((x) => x.name === "M_Levy");
m.pbrMetallicRoughness = {
  baseColorTexture: { index: 0 },
  metallicRoughnessTexture: { index: 2 },
  metallicFactor: 1,
  roughnessFactor: 1,
};
m.normalTexture = { index: 1 };
m.occlusionTexture = { index: 2 };
m.alphaMode = "OPAQUE";

const stage = join(DST, "levy_src");
mkdirSync(stage, { recursive: true });
writeFileSync(join(stage, "levy_src.gltf"), JSON.stringify(g));
copyFileSync(join(SRC, "levy_src.bin"), join(stage, "levy_src.bin"));
for (const t of TEX) {
  copyFileSync(join(SRC, t), join(stage, t));
  copyFileSync(join(SRC, t), join(DST, t));
}

const out = join(DST, "levy.glb");
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
execFileSync(npx, ["gltfpack", "-i", join(stage, "levy_src.gltf"), "-o", out, "-cc", "-kn", "-km", "-af", "30", "-tr", "-v"], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
rmSync(stage, { recursive: true, force: true });

writeFileSync(
  join(DST, "levy.anim.json"),
  JSON.stringify(
    {
      fps: 30,
      clips: {
        Idle_Guard: { speed: 0, footplant: [0] },
        Walk_Carry: { speed: 1.4, stride: 1.49, footplant: [0, 16] },
        Thrust_High: { contact: 9, footplant: [7], cancelFrom: 15, travel: 0.35 },
        Death_Back: { holdFrom: 36 },
      },
    },
    null,
    2,
  ) + "\n",
);

const glb = readFileSync(out);
const json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString("utf8"));
console.log("LEVY_GLB", glb.length, "bytes; images:", JSON.stringify(json.images), "anims:", json.animations.map((a) => a.name).join(","));
