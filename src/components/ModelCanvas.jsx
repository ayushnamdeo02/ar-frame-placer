/**
 * ModelCanvas Component
 * 3D model rendering with Three.js and React Three Fiber
 */

import React, { useRef, useEffect, useState, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import {
  OrbitControls,
  PerspectiveCamera,
  Environment,
  Grid,
  ContactShadows,
  useGLTF,
  Center,
  Bounds,
} from '@react-three/drei';
import * as THREE from 'three';
import useARStore from '../store/useARStore';

/**
 * Model Component - Loads and displays the 3D model
 */
function Model({ url }) {
  const groupRef = useRef();
  const { position, rotation, scale } = useARStore();

  // Load the model using useGLTF hook
  const { scene } = useGLTF(url, true);

  // Clone the scene to avoid conflicts
  const clonedScene = React.useMemo(() => {
    const clone = scene.clone(true);

    // Configure materials and shadows
    clone.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;

        // Ensure proper material rendering
        if (child.material) {
          child.material.side = THREE.DoubleSide;
          child.material.needsUpdate = true;
        }
      }
    });

    return clone;
  }, [scene]);

  // Update transform
  useFrame(() => {
    if (groupRef.current) {
      groupRef.current.position.set(position.x, position.y, position.z);
      groupRef.current.rotation.set(rotation.x, rotation.y, rotation.z);
      groupRef.current.scale.setScalar(scale);
    }
  });

  return (
    <Center>
      <Bounds fit clip observe margin={1.2}>
        <primitive ref={groupRef} object={clonedScene} />
      </Bounds>
    </Center>
  );
}

/**
 * Loading Fallback - Shows while model is loading
 */
function LoadingBox() {
  const meshRef = useRef();

  useFrame((state) => {
    if (meshRef.current) {
      meshRef.current.rotation.x = state.clock.elapsedTime * 0.5;
      meshRef.current.rotation.y = state.clock.elapsedTime * 0.3;
    }
  });

  return (
    <mesh ref={meshRef}>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color="#007AFF"
        wireframe
        transparent
        opacity={0.6}
      />
    </mesh>
  );
}

/**
 * Scene Setup Component
 */
function SceneSetup({ showGrid }) {
  return (
    <>
      {/* Lighting */}
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[10, 10, 5]}
        intensity={1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
        shadow-camera-far={50}
        shadow-camera-left={-10}
        shadow-camera-right={10}
        shadow-camera-top={10}
        shadow-camera-bottom={-10}
      />
      <pointLight position={[-10, -10, -5]} intensity={0.3} />
      <hemisphereLight
        skyColor={new THREE.Color('#ffffff')}
        groundColor={new THREE.Color('#666666')}
        intensity={0.4}
      />

      {/* Environment */}
      <Environment preset="city" />

      {/* Grid */}
      {showGrid && (
        <Grid
          args={[10, 10]}
          cellSize={0.5}
          cellThickness={0.5}
          cellColor="#6e6e6e"
          sectionSize={2}
          sectionThickness={1}
          sectionColor="#9d4b4b"
          fadeDistance={25}
          fadeStrength={1}
          followCamera={false}
          infiniteGrid
        />
      )}

      {/* Contact Shadows */}
      <ContactShadows
        position={[0, -1.5, 0]}
        opacity={0.5}
        scale={10}
        blur={2}
        far={4}
      />
    </>
  );
}

/**
 * Camera Controller
 */
function CameraController() {
  const { camera } = useThree();

  useEffect(() => {
    camera.position.set(0, 0, 5);
    camera.lookAt(0, 0, 0);
  }, [camera]);

  return null;
}

/**
 * Performance Monitor
 */
function PerformanceMonitor() {
  const [fps, setFps] = useState(60);
  const frameCount = useRef(0);
  const lastTime = useRef(performance.now());

  useFrame(() => {
    frameCount.current++;

    const currentTime = performance.now();
    const deltaTime = currentTime - lastTime.current;

    if (deltaTime >= 1000) {
      setFps(Math.round((frameCount.current * 1000) / deltaTime));
      frameCount.current = 0;
      lastTime.current = currentTime;
    }
  });

  if (process.env.NODE_ENV === 'development') {
    return (
      <Html position={[-4, 3, 0]}>
        <div style={{
          background: 'rgba(0, 0, 0, 0.8)',
          color: 'white',
          padding: '0.5rem 1rem',
          borderRadius: '8px',
          fontSize: '0.875rem',
          fontFamily: 'monospace',
        }}>
          FPS: {fps}
        </div>
      </Html>
    );
  }

  return null;
}

/**
 * Main ModelCanvas Component
 */
export default function ModelCanvas({
  modelUrl,
  enableControls = true,
  enablePerformanceMonitor = false,
}) {
  const { showGrid, setError } = useARStore();

  const handleError = (error) => {
    console.error('3D Canvas Error:', error);
    setError('Failed to render 3D model. Please try a different model.');
  };

  return (
    <Canvas
      className="model-canvas"
      shadows
      dpr={[1, 2]}
      gl={{
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: 'high-performance',
      }}
      onError={handleError}
    >
      {/* Camera */}
      <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={50} />
      <CameraController />

      {/* Scene Setup */}
      <SceneSetup showGrid={showGrid} />

      {/* 3D Model */}
      <Suspense fallback={<LoadingBox />}>
        {modelUrl && <Model url={modelUrl} />}
      </Suspense>

      {/* Controls */}
      {enableControls && (
        <OrbitControls
          enableDamping
          dampingFactor={0.05}
          minDistance={1}
          maxDistance={10}
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          maxPolarAngle={Math.PI}
          minPolarAngle={0}
        />
      )}

      {/* Performance Monitor */}
      {enablePerformanceMonitor && <PerformanceMonitor />}
    </Canvas>
  );
}

/**
 * Preload models for better performance
 */
export function preloadModel(url) {
  useGLTF.preload(url);
}

/**
 * Clear model cache
 */
export function clearModelCache() {
  useGLTF.clear();
}

// Configure DRACO decoder for compressed models
useGLTF.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');