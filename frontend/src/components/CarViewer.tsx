import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import { applyPaint } from '@car3d/paint.js'
import type { RenderSpec } from '../lib/api'

type Stage = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: OrbitControls
  loader: GLTFLoader
  car: THREE.Object3D | null
  carModel: string | null
  frame: number
}

export default function CarViewer({ spec }: { spec: RenderSpec }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<Stage | null>(null)

  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    mount.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.environment = new THREE.PMREMGenerator(renderer).fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture
    // soft, flat, toy-like light rather than a reflective showroom
    scene.environmentIntensity = 0.5

    // far enough back that a full-size wagon fits the frame with margin
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100)
    camera.position.set(5.4, 2.1, 6.4)

    const key = new THREE.DirectionalLight(0xfff4e0, 0.9)
    key.position.set(4, 6, 3)
    scene.add(key, new THREE.AmbientLight(0xffffff, 1.1))

    const ground = new THREE.Mesh(
      new THREE.CircleGeometry(4.2, 48),
      new THREE.MeshStandardMaterial({ color: 0xccd1da, roughness: 1 }),
    )
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)

    const controls = new OrbitControls(camera, renderer.domElement)
    controls.target.set(0, 0.6, 0)
    controls.enablePan = false
    controls.autoRotate = true
    controls.autoRotateSpeed = 1.2
    controls.minDistance = 3
    controls.maxDistance = 10
    controls.maxPolarAngle = Math.PI / 2.05

    const stage: Stage = {
      renderer, scene, camera, controls,
      loader: new GLTFLoader(), car: null, carModel: null, frame: 0,
    }
    stageRef.current = stage

    const resize = () => {
      const { clientWidth: w, clientHeight: h } = mount
      if (!w || !h) return
      renderer.setSize(w, h)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.render(scene, camera)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(mount)

    const animate = () => {
      stage.frame = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    return () => {
      cancelAnimationFrame(stage.frame)
      observer.disconnect()
      controls.dispose()
      renderer.dispose()
      mount.removeChild(renderer.domElement)
      stageRef.current = null
    }
  }, [])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    if (stage.carModel === spec.model && stage.car) {
      applyPaint(stage.car, spec)
      stage.renderer.render(stage.scene, stage.camera)
      return
    }

    let cancelled = false
    stage.loader.load(
      spec.model_url,
      (gltf) => {
        if (cancelled || !stageRef.current) return
        if (stage.car) stage.scene.remove(stage.car)
        stage.car = gltf.scene
        stage.carModel = spec.model
        applyPaint(gltf.scene, spec)

        // centre the car on the turntable, wheels on the ground
        const box = new THREE.Box3().setFromObject(gltf.scene)
        const centre = box.getCenter(new THREE.Vector3())
        gltf.scene.position.sub(centre)
        gltf.scene.position.y = -box.min.y
        stage.controls.target.set(0, (box.max.y - box.min.y) / 2, 0)
        stage.scene.add(gltf.scene)
        stage.renderer.render(stage.scene, stage.camera)
      },
      undefined,
      (error) => console.error('CarViewer: failed to load model', error),
    )
    return () => {
      cancelled = true
    }
  }, [spec])

  return <div ref={mountRef} className="fmc-viewer" />
}
