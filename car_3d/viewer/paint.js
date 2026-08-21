/**
 * Lak-contract voor de meegeleverde .glb modellen.
 *
 * De modellen hebben hun lakkleur ingebakken in de albedo-texture, samen met
 * ruiten, lampen en sierlijsten. Om alleen de gespoten panelen te verkleuren
 * is het lakmasker opgeslagen in het ALPHA-kanaal van diezelfde texture:
 * alpha 1 = lak, alpha 0 = alles wat zijn eigen kleur moet houden.
 *
 * Zonder deze hook laadt het model gewoon in zijn originele kleur -- een
 * Compact blijft dan cyaan, wat verf_hex ook zegt.
 *
 *   import { applyPaint } from './paint.js';
 *   const gltf = await new GLTFLoader().loadAsync(spec.model_url);
 *   applyPaint(gltf.scene, spec);      // spec = render_spec() uit styling.py
 *   scene.add(gltf.scene);
 *
 * Later van kleur wisselen zonder opnieuw te laden: roep applyPaint nog een
 * keer aan op hetzelfde object.
 */
import * as THREE from 'three';

const CHUNK_MAP = `
  #ifdef USE_MAP
  vec4 sampledDiffuseColor = texture2D( map, vMapUv );
  gPaintMask = sampledDiffuseColor.a;
  sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, uPaintColor, gPaintMask );
  sampledDiffuseColor.a = 1.0;
  diffuseColor *= sampledDiffuseColor;
  #endif
`;

function isPaintable(material) {
  return Boolean(material.userData?.paintable) || material.name?.startsWith('paint:');
}

function hookMaterial(material) {
  if (material.userData.paintUniforms) return material.userData.paintUniforms;

  const uniforms = {
    uPaintColor: { value: new THREE.Color(0xffffff) },
    uPaintMetal: { value: 0.85 },
    uPaintRough: { value: 0.22 },
  };
  material.userData.paintUniforms = uniforms;

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `
        uniform vec3 uPaintColor;
        uniform float uPaintMetal;
        uniform float uPaintRough;
        float gPaintMask = 0.0;
        void main() {`)
      .replace('#include <map_fragment>', CHUNK_MAP)
      .replace('#include <metalnessmap_fragment>',
        `#include <metalnessmap_fragment>
         metalnessFactor = mix( metalnessFactor, uPaintMetal, gPaintMask );`)
      .replace('#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
         roughnessFactor = mix( roughnessFactor, uPaintRough, gPaintMask );`);
  };
  // alle gelakte materialen delen dezelfde shader; uniforms blijven per materiaal
  material.customProgramCacheKey = () => 'paintable';
  material.needsUpdate = true;
  return uniforms;
}

/**
 * Spuit een geladen model in de kleur uit render_spec().
 * @param {THREE.Object3D} root  gltf.scene
 * @param {{paint_hex:string, metalness?:number, roughness?:number}} spec
 * @returns {number} aantal gelakte materialen (0 = verkeerd model of oud bestand)
 */
export function applyPaint(root, spec) {
  const colour = new THREE.Color().setStyle(spec.paint_hex, THREE.SRGBColorSpace);
  let painted = 0;
  root.traverse((object) => {
    if (!object.isMesh) return;
    const material = object.material;
    if (isPaintable(material)) {
      const uniforms = hookMaterial(material);
      uniforms.uPaintColor.value.copy(colour);
      uniforms.uPaintMetal.value = spec.metalness ?? 0.85;
      uniforms.uPaintRough.value = spec.roughness ?? 0.22;
      painted += 1;
    } else if (material.name === 'Glass') {
      material.transparent = true;
      material.opacity = 0.42;
      material.roughness = 0.05;
      material.metalness = 0.0;
      material.envMapIntensity = 2.2;
    }
  });
  return painted;
}
