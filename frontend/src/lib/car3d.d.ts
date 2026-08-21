declare module '@car3d/paint.js' {
  import type { Object3D } from 'three'
  export function applyPaint(
    root: Object3D,
    spec: { paint_hex: string; metalness?: number; roughness?: number },
  ): number
}
