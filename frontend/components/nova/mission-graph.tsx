'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as THREE from 'three'

export type MissionNodeStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
export type MissionGraphNode = {
  id: string
  title: string
  status: MissionNodeStatus
  description: string
  timestamp?: string
  output?: string
  error?: string
}

function nodePosition(index: number, count: number) {
  return new THREE.Vector3(-4.2 + (8.4 * index) / Math.max(count - 1, 1), index % 2 ? -0.08 : 0.3, 0)
}

function statusColor(status: MissionNodeStatus) {
  if (status === 'completed') return '#42e8d0'
  if (status === 'running') return '#a9f8ff'
  if (status === 'failed') return '#ff718c'
  if (status === 'cancelled') return '#d1a5ff'
  return '#365866'
}

function Connection({ start, end, active }: { start: THREE.Vector3; end: THREE.Vector3; active: boolean }) {
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(
    start,
    new THREE.Vector3((start.x + end.x) / 2, Math.max(start.y, end.y) + 0.62, 0),
    end,
  ), [start, end])
  const tube = useMemo(() => new THREE.TubeGeometry(curve, 32, 0.012, 5, false), [curve])
  const particles = useRef<Array<THREE.Mesh | null>>([])
  useFrame(({ clock }) => {
    if (!active) return
    particles.current.forEach((particle, index) => {
      if (particle) particle.position.copy(curve.getPoint((clock.elapsedTime * 0.34 + index * 0.42) % 1))
    })
  })
  return <>
    <mesh geometry={tube}>
      <meshBasicMaterial color={active ? '#34dff3' : '#173946'} transparent opacity={active ? 0.72 : 0.48} />
    </mesh>
    {active && [0, 1].map(index => <mesh key={index} ref={element => { particles.current[index] = element }} scale={index ? 0.055 : 0.075}>
      <sphereGeometry args={[1, 10, 10]} />
      <meshBasicMaterial color={index ? '#59dcf2' : '#d7fcff'} />
    </mesh>)}
  </>
}

function GraphNode({ node, position, onSelect, selected }: {
  node: MissionGraphNode
  position: THREE.Vector3
  onSelect: (id: string) => void
  selected: boolean
}) {
  const group = useRef<THREE.Group>(null)
  const color = statusColor(node.status)
  useFrame(({ clock }) => {
    if (!group.current || node.status !== 'running') return
    const pulse = 1 + Math.sin(clock.elapsedTime * 4.5) * 0.1
    group.current.scale.setScalar(pulse)
  })
  return <group ref={group} position={position} onClick={event => { event.stopPropagation(); onSelect(node.id) }}>
    <mesh>
      <sphereGeometry args={[selected ? 0.19 : 0.15, 20, 20]} />
      <meshBasicMaterial color={color} transparent opacity={node.status === 'pending' ? 0.48 : 0.94} />
    </mesh>
    <mesh>
      <torusGeometry args={[selected ? 0.29 : 0.24, 0.009, 6, 32]} />
      <meshBasicMaterial color={color} transparent opacity={node.status === 'running' ? 0.9 : 0.55} />
    </mesh>
    {node.status === 'running' && <mesh>
      <sphereGeometry args={[0.34, 16, 16]} />
      <meshBasicMaterial color={color} transparent opacity={0.08} />
    </mesh>}
  </group>
}

function NovaCore({ reducedMotion }: { reducedMotion: boolean }) {
  const core = useRef<THREE.Group>(null)
  useFrame(({ clock }, delta) => {
    if (!core.current || reducedMotion) return
    core.current.rotation.y += delta * 0.22
    core.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2) * 0.035)
  })
  return <group ref={core} position={[0, -1.05, 0]}>
    <mesh><sphereGeometry args={[0.43, 24, 24]} /><meshBasicMaterial color="#04202c" /></mesh>
    <mesh><icosahedronGeometry args={[0.48, 2]} /><meshBasicMaterial color="#48e4f5" wireframe transparent opacity={0.28} /></mesh>
    <mesh rotation={[Math.PI / 2, 0.2, 0.4]}><torusGeometry args={[0.59, 0.009, 6, 72]} /><meshBasicMaterial color="#9cf9ff" transparent opacity={0.5} /></mesh>
    <pointLight color="#35d8f2" intensity={1.1} distance={2.2} />
  </group>
}

function GraphScene({ nodes, selectedId, onSelect, reducedMotion }: {
  nodes: MissionGraphNode[]
  selectedId: string
  onSelect: (id: string) => void
  reducedMotion: boolean
}) {
  const positions = useMemo(() => nodes.map((_, index) => nodePosition(index, nodes.length)), [nodes.length])
  const scene = useRef<THREE.Group>(null)
  useFrame(({ clock, camera }) => {
    if (reducedMotion) return
    if (scene.current) scene.current.rotation.y = Math.sin(clock.elapsedTime * 0.16) * 0.035
    camera.position.x += (Math.sin(clock.elapsedTime * 0.12) * 0.16 - camera.position.x) * 0.015
    camera.position.y += (0.15 + Math.cos(clock.elapsedTime * 0.1) * 0.035 - camera.position.y) * 0.015
    camera.lookAt(0, 0, 0)
  })
  return <group ref={scene}>
    {positions.slice(0, -1).map((position, index) => (
      <Connection
        key={`${nodes[index].id}-${nodes[index + 1].id}`}
        start={position}
        end={positions[index + 1]}
        active={nodes[index + 1].status === 'running'}
      />
    ))}
    {nodes.map((node, index) => (
      <GraphNode key={node.id} node={node} position={positions[index]} onSelect={onSelect} selected={node.id === selectedId} />
    ))}
    <NovaCore reducedMotion={reducedMotion} />
  </group>
}

export default function MissionGraph({ nodes, reducedMotion }: { nodes: MissionGraphNode[]; reducedMotion: boolean }) {
  const [selectedId, setSelectedId] = useState(nodes.find(node => node.status === 'running')?.id ?? nodes[0]?.id ?? '')
  useEffect(() => {
    const active = nodes.find(node => node.status === 'running')
    if (active) setSelectedId(active.id)
  }, [nodes])
  const selected = nodes.find(node => node.id === selectedId) ?? nodes[0]
  return <section className="mission-graph" aria-label="Live mission execution graph">
    <div className="mission-graph-head"><span>LIVE EXECUTION GRAPH</span><span>{nodes.filter(node => node.status === 'completed').length}/{nodes.length} COMPLETE</span></div>
    <div className="mission-graph-canvas">
      <Canvas
        dpr={[1, 1.25]}
        camera={{ position: [0, 0.15, 10.7], fov: 40 }}
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
        fallback={<div className="mission-graph-fallback">3D graphics are unavailable. Mission stages and status remain available below.</div>}
      >
        <GraphScene nodes={nodes} selectedId={selectedId} onSelect={setSelectedId} reducedMotion={reducedMotion} />
      </Canvas>
    </div>
    <ol className="mission-graph-nodes">
      {nodes.map(node => (
        <li key={node.id}>
          <button type="button" className={`graph-node-button ${node.status} ${selectedId === node.id ? 'selected' : ''}`} onClick={() => setSelectedId(node.id)}>
            <span className="graph-node-mark" aria-hidden="true">{node.status === 'completed' ? '✓' : node.status === 'failed' ? '!' : node.status === 'cancelled' ? '×' : node.status === 'running' ? '●' : '○'}</span>
            <span>{node.title}</span>
            <small>{node.status.replace('_', ' ').toUpperCase()}</small>
          </button>
        </li>
      ))}
    </ol>
    {selected && <div className={`graph-node-detail ${selected.status}`}>
      <div><strong>{selected.title}</strong><span>{selected.status.toUpperCase()}</span></div>
      <p>{selected.error || selected.output || selected.description}</p>
      {selected.timestamp && <time dateTime={selected.timestamp}>{new Date(selected.timestamp).toLocaleString()}</time>}
    </div>}
  </section>
}
