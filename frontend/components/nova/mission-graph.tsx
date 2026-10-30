'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'
import type { MissionGraphNode, MissionNodeStatus, MissionState } from '@/lib/mission-events'

function nodePosition(index: number, count: number) {
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / Math.max(count, 1))
  return new THREE.Vector3(
    Math.cos(angle) * 3.25,
    Math.sin(angle) * 1.42,
    Math.sin(angle * 2) * 0.38,
  )
}

function labelPosition(index: number, count: number) {
  const angle = -Math.PI / 2 + index * (Math.PI * 2 / Math.max(count, 1))
  return {
    left: `${50 + Math.cos(angle) * 27}%`,
    top: `${50 - Math.sin(angle) * 28}%`,
  }
}

function statusColor(status: MissionNodeStatus) {
  if (status === 'completed') return '#42e8d0'
  if (status === 'running') return '#a9f8ff'
  if (status === 'failed') return '#ff718c'
  if (status === 'cancelled') return '#d1a5ff'
  return '#365866'
}

function nodeAccent(node: MissionGraphNode, index: number) {
  if (node.status !== 'completed') return statusColor(node.status)
  return ['#35bfff', '#35e2d0', '#f0b65c', '#9c77ff'][index % 4]
}

function Orbit({ radiusX, radiusY, rotation, opacity }: {
  radiusX: number
  radiusY: number
  rotation: number
  opacity: number
}) {
  const geometry = useMemo(() => {
    const ellipse = new THREE.EllipseCurve(0, 0, radiusX, radiusY, 0, Math.PI * 2, false, rotation)
    const points = ellipse.getPoints(128).map(point => new THREE.Vector3(point.x, point.y, 0))
    return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points, true), 128, 0.009, 4, true)
  }, [radiusX, radiusY, rotation])
  return <mesh geometry={geometry}>
    <meshBasicMaterial color="#2186a7" transparent opacity={opacity} />
  </mesh>
}

function StarField() {
  const geometry = useMemo(() => {
    const points = Array.from({ length: 92 }, (_, index) => {
      const x = Math.sin(index * 127.1) * 5.3
      const y = Math.sin(index * 311.7) * 2.5
      const z = Math.cos(index * 74.7) * 1.8 - 1.2
      return new THREE.Vector3(x, y, z)
    })
    return new THREE.BufferGeometry().setFromPoints(points)
  }, [])
  return <points geometry={geometry}>
    <pointsMaterial color="#4dc9ff" size={0.018} transparent opacity={0.52} sizeAttenuation />
  </points>
}

function Connection({ start, end, status, reducedMotion }: {
  start: THREE.Vector3
  end: THREE.Vector3
  status: MissionNodeStatus
  reducedMotion: boolean
}) {
  const active = status === 'running'
  const completed = status === 'completed'
  const curve = useMemo(() => new THREE.QuadraticBezierCurve3(
    start,
    new THREE.Vector3(
      (start.x + end.x) / 2,
      (start.y + end.y) / 2 + (start.x <= end.x ? 0.42 : -0.42),
      Math.max(start.z, end.z) + 0.55,
    ),
    end,
  ), [start, end])
  const tube = useMemo(() => new THREE.TubeGeometry(curve, 32, 0.012, 5, false), [curve])
  const particles = useRef<Array<THREE.Mesh | null>>([])
  useFrame(({ clock }) => {
    if (!active || reducedMotion) return
    particles.current.forEach((particle, index) => {
      if (particle) particle.position.copy(curve.getPoint((clock.elapsedTime * 0.34 + index * 0.42) % 1))
    })
  })
  return <>
    <mesh geometry={tube}>
      <meshBasicMaterial color={active ? '#34dff3' : completed ? '#42e8d0' : '#173946'} transparent opacity={active ? 0.86 : completed ? 0.72 : 0.42} />
    </mesh>
    {active && [0, 1].map(index => <mesh key={index} ref={element => { particles.current[index] = element }} scale={index ? 0.055 : 0.075}>
      <sphereGeometry args={[1, 10, 10]} />
      <meshBasicMaterial color={index ? '#59dcf2' : '#d7fcff'} />
    </mesh>)}
  </>
}

function GraphNode({ node, position, index, onSelect, selected, reducedMotion }: {
  node: MissionGraphNode
  position: THREE.Vector3
  index: number
  onSelect: (id: string) => void
  selected: boolean
  reducedMotion: boolean
}) {
  const group = useRef<THREE.Group>(null)
  const color = nodeAccent(node, index)
  const pulseScale = useRef(0.01)
  useFrame(({ clock }) => {
    if (!group.current) return
    const pulse = node.status === 'running' ? 1 + Math.sin(clock.elapsedTime * 4.5) * 0.1 : 1
    const targetScale = (selected ? 1.12 : 1) * pulse
    pulseScale.current = reducedMotion
      ? targetScale
      : THREE.MathUtils.damp(pulseScale.current, targetScale, 8, 1 / 60)
    group.current.scale.setScalar(pulseScale.current)
  })
  return <group ref={group} position={position}
    onClick={event => { event.stopPropagation(); onSelect(node.id) }}
    onPointerOver={() => { document.body.style.cursor = 'pointer' }}
    onPointerOut={() => { document.body.style.cursor = '' }}>
    <mesh>
      <sphereGeometry args={[selected ? 0.39 : 0.33, 28, 28]} />
      <meshBasicMaterial color={color} transparent opacity={node.status === 'pending' ? 0.48 : 0.94} />
    </mesh>
    <mesh>
      <icosahedronGeometry args={[selected ? 0.38 : 0.32, 1]} />
      <meshBasicMaterial color={color} wireframe transparent opacity={0.3} />
    </mesh>
    <mesh>
      <torusGeometry args={[selected ? 0.53 : 0.45, 0.014, 8, 48]} />
      <meshBasicMaterial color={color} transparent opacity={node.status === 'running' ? 0.9 : 0.55} />
    </mesh>
    <pointLight color={color} intensity={selected || node.status === 'running' ? 1.25 : 0.7} distance={2.2} />
    {node.status === 'running' && <mesh>
      <sphereGeometry args={[0.61, 20, 20]} />
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
  return <group ref={core} position={[0, 0, 0]}>
    <mesh><sphereGeometry args={[0.86, 36, 36]} /><meshBasicMaterial color="#031a2d" /></mesh>
    <mesh><icosahedronGeometry args={[0.9, 2]} /><meshBasicMaterial color="#4ba9ff" wireframe transparent opacity={0.34} /></mesh>
    <mesh rotation={[Math.PI / 2, 0.2, 0.4]}><torusGeometry args={[1.06, 0.016, 8, 96]} /><meshBasicMaterial color="#9cf9ff" transparent opacity={0.62} /></mesh>
    <mesh rotation={[0.55, 0.4, 0.2]}><torusGeometry args={[1.25, 0.008, 6, 96]} /><meshBasicMaterial color="#3288ff" transparent opacity={0.36} /></mesh>
    <pointLight color="#35d8f2" intensity={2.1} distance={3.8} />
  </group>
}

function GraphScene({ nodes, selectedId, onSelect, reducedMotion }: {
  nodes: MissionGraphNode[]
  selectedId: string
  onSelect: (id: string) => void
  reducedMotion: boolean
}) {
  const positions = useMemo(() => nodes.map((_, index) => nodePosition(index, nodes.length)), [nodes.length])
  const connections = useMemo(() => nodes.flatMap((node, targetIndex) =>
    node.dependsOn.flatMap(dependencyId => {
      const sourceIndex = nodes.findIndex(candidate => candidate.id === dependencyId)
      return sourceIndex < 0 ? [] : [{ sourceIndex, targetIndex }]
    })), [nodes])
  const scene = useRef<THREE.Group>(null)
  useFrame(({ clock, camera }) => {
    if (!reducedMotion && scene.current) scene.current.rotation.y = Math.sin(clock.elapsedTime * 0.16) * 0.035
    const cameraTarget = Math.max(8.8, 7.5 + nodes.length * 0.7)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, cameraTarget, 2.5, 1 / 60)
    if (!reducedMotion) {
      camera.position.x += (Math.sin(clock.elapsedTime * 0.12) * 0.16 - camera.position.x) * 0.015
      camera.position.y += (0.15 + Math.cos(clock.elapsedTime * 0.1) * 0.035 - camera.position.y) * 0.015
    } else {
      camera.position.x = THREE.MathUtils.damp(camera.position.x, 0, 4, 1 / 60)
      camera.position.y = THREE.MathUtils.damp(camera.position.y, 0.15, 4, 1 / 60)
    }
    camera.lookAt(0, 0, 0)
  })
  return <group ref={scene}>
    <StarField />
    <Orbit radiusX={4.55} radiusY={2.05} rotation={-0.08} opacity={0.58} />
    <Orbit radiusX={3.95} radiusY={1.66} rotation={0.12} opacity={0.32} />
    <Orbit radiusX={3.3} radiusY={1.29} rotation={-0.14} opacity={0.22} />
    {connections.map(({ sourceIndex, targetIndex }) => (
      <Connection
        key={`${nodes[sourceIndex].id}-${nodes[targetIndex].id}`}
        start={positions[sourceIndex]}
        end={positions[targetIndex]}
        status={nodes[targetIndex].status}
        reducedMotion={reducedMotion}
      />
    ))}
    {nodes.map((node, index) => (
      <GraphNode key={node.id} node={node} position={positions[index]} index={index} onSelect={onSelect} selected={node.id === selectedId} reducedMotion={reducedMotion} />
    ))}
    <NovaCore reducedMotion={reducedMotion} />
  </group>
}

export default function MissionGraph({ nodes, status, reducedMotion, request, selectedNodeId, onSelectNode }: {
  nodes: MissionGraphNode[]
  status: MissionState['status']
  reducedMotion: boolean
  request: string
  selectedNodeId: string
  onSelectNode: (id: string) => void
}) {
  return <section className="mission-graph" aria-label="Live mission execution graph">
    <div className="mission-graph-head">
      <div className="mission-graph-title">
        <span>LIVE EXECUTION GRAPH</span>
        <strong>{request || 'Waiting for a mission request'}</strong>
      </div>
      <span className={`mission-graph-count`}>{nodes.filter(node => node.status === 'completed').length}/{nodes.length} COMPLETE</span>
      <span className={`mission-graph-status ${status}`} role="status"><i />MISSION {status === 'connecting' ? 'AWAITING BACKEND' : status.toUpperCase()}</span>
    </div>
    <div className="mission-graph-canvas">
      {!nodes.length && <div className="mission-graph-empty">Waiting for the backend to report executed stages...</div>}
      <Canvas
        dpr={[1, 1.25]}
        camera={{ position: [0, 0.1, 10.4], fov: 39 }}
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
        fallback={<div className="mission-graph-fallback">3D graphics are unavailable. Mission stages and status remain available below.</div>}
      >
        <GraphScene nodes={nodes} selectedId={selectedNodeId} onSelect={onSelectNode} reducedMotion={reducedMotion} />
      </Canvas>
      <span className="mission-core-wordmark" aria-hidden="true">NOVA</span>
      <div className="mission-graph-labels" aria-label="Mission graph nodes">
        {nodes.map((node, index) => (
          <button
            type="button"
            key={node.id}
            style={labelPosition(index, nodes.length)}
            className={`mission-node-label ${node.status} ${selectedNodeId === node.id ? 'selected' : ''}`}
            onClick={() => onSelectNode(node.id)}
          >
            <span className="mission-node-label-mark">{node.status === 'completed' ? '✓' : node.status === 'failed' ? '!' : node.status === 'cancelled' ? '×' : '●'}</span>
            <span><strong>{index + 1}. {node.title}</strong><small>{node.status.toUpperCase()}</small></span>
          </button>
        ))}
      </div>
    </div>
  </section>
}
