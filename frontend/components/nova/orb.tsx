'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

export type CoreState = 'idle' | 'listening' | 'thinking' | 'responding' | 'error'

function Core({ state, reduced }: { state: CoreState; reduced: boolean }) {
  const group = useRef<THREE.Group>(null)
  const particles = useMemo(() => {
    const positions = new Float32Array(12000)
    for (let i = 0; i < 4000; i++) {
      const y = 1 - (i / 3999) * 2
      const r = Math.sqrt(1 - y * y)
      const a = i * Math.PI * (3 - Math.sqrt(5))
      const radius = 1.48 + Math.sin(i * 3.7) * .04
      positions.set([Math.cos(a) * r * radius, y * radius, Math.sin(a) * r * radius], i * 3)
    }
    return positions
  }, [])
  useFrame(({ clock }, delta) => {
    if (!group.current || reduced) return
    const speed = state === 'thinking' ? .48 : state === 'listening' ? .24 : .065
    group.current.rotation.y += delta * speed
    group.current.rotation.z = Math.sin(clock.elapsedTime * .15) * .08
    const pulse = state === 'idle' ? .008 : .035
    group.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * (state === 'responding' ? 6 : 2)) * pulse)
  })
  const color = state === 'error' ? '#ff8c9d' : state === 'listening' ? '#b0f9ff' : '#38dcf5'
  return <group ref={group} rotation={[.15, 0, -.1]}>
    <mesh><sphereGeometry args={[1.43, 48, 48]} /><meshBasicMaterial color="#02121e" /></mesh>
    <mesh><icosahedronGeometry args={[1.46, 3]} /><meshBasicMaterial color={color} wireframe transparent opacity={.14} /></mesh>
    <points><bufferGeometry><bufferAttribute attach="attributes-position" args={[particles, 3]} /></bufferGeometry><pointsMaterial color={color} size={.018} transparent opacity={.8} sizeAttenuation blending={THREE.AdditiveBlending} depthWrite={false} /></points>
    {[0, 1, 2].map(i => <mesh key={i} rotation={[Math.PI / 2 + i * .32, i * .38, i * .45]}><torusGeometry args={[1.85 + i * .22, .004, 6, 180]} /><meshBasicMaterial color={color} transparent opacity={.28} /></mesh>)}
    <mesh rotation={[.8, -.4, .5]}><torusGeometry args={[1.49, .014, 8, 160, 4.4]} /><meshBasicMaterial color={color} transparent opacity={.7} /></mesh>
  </group>
}

export default function Orb({ state, reduced }: { state: CoreState; reduced: boolean }) {
  return <div className={`orb-canvas state-${state}`} aria-hidden="true"><div className="orb-aura" /><Canvas dpr={[1, 1.5]} camera={{ position: [0, 0, 7.8], fov: 39 }} gl={{ alpha: true, antialias: true }} fallback={<div className="orb-fallback" />}><Core state={state} reduced={reduced} /></Canvas></div>
}
