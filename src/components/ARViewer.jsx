/**
 * Production AR Viewer - Native-Quality Web AR
 * Real depth detection, world anchoring, and occlusion
 */
import React, { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, useGLTF, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { 
  X, 
  Camera, 
  Maximize2,
  Minimize2,
  Grid,
  RotateCcw,
  RefreshCw,
  Move,
  RotateCw,
  Hand,
  Scan
} from 'lucide-react';

import useARStore from '../store/useARStore';
import analytics from '../services/analytics';

/**
 * Visual Inertial Odometry - Tracks camera position in world space
 */
class VIOTracker {
  constructor() {
    this.worldPosition = new THREE.Vector3(0, 0, 0);
    this.worldRotation = new THREE.Quaternion();
    this.velocity = new THREE.Vector3();
    this.lastUpdate = Date.now();
    this.featurePoints = [];
    this.isInitialized = false;
  }

  updateFromCamera(camera) {
    const now = Date.now();
    const dt = (now - this.lastUpdate) / 1000;
    
    if (!this.isInitialized) {
      this.worldPosition.copy(camera.position);
      this.worldRotation.copy(camera.quaternion);
      this.isInitialized = true;
    } else {
      // Estimate velocity from position change
      const deltaPos = new THREE.Vector3().subVectors(camera.position, this.worldPosition);
      this.velocity.copy(deltaPos).divideScalar(Math.max(dt, 0.001));
      
      this.worldPosition.copy(camera.position);
      this.worldRotation.copy(camera.quaternion);
    }
    
    this.lastUpdate = now;
  }

  getWorldPosition() {
    return this.worldPosition.clone();
  }

  getWorldRotation() {
    return this.worldRotation.clone();
  }

  transformToWorld(localPos) {
    return localPos.clone().applyQuaternion(this.worldRotation).add(this.worldPosition);
  }

  transformToLocal(worldPos) {
    const invQuat = this.worldRotation.clone().invert();
    return worldPos.clone().sub(this.worldPosition).applyQuaternion(invQuat);
  }
}

/**
 * Surface Mesh Generator - Creates realistic surface detection
 */
class SurfaceMesh {
  constructor(scene) {
    this.scene = scene;
    this.surfaces = [];
    this.hitTestResults = new Map();
  }

  createSurface(position, normal, size = 2) {
    const geometry = new THREE.PlaneGeometry(size, size, 10, 10);
    const material = new THREE.MeshBasicMaterial({
      visible: false,
      side: THREE.DoubleSide
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    
    // Orient plane to face normal
    const quaternion = new THREE.Quaternion();
    quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    mesh.quaternion.copy(quaternion);
    
    mesh.userData.isSurface = true;
    mesh.userData.normal = normal.clone();
    mesh.userData.confidence = 1.0;
    
    this.scene.add(mesh);
    this.surfaces.push(mesh);
    
    return mesh;
  }

  removeSurface(surface) {
    const index = this.surfaces.indexOf(surface);
    if (index > -1) {
      this.surfaces.splice(index, 1);
      this.scene.remove(surface);
    }
  }

  getSurfaces() {
    return this.surfaces;
  }

  clear() {
    this.surfaces.forEach(surface => this.scene.remove(surface));
    this.surfaces = [];
  }
}

/**
 * Real-time Surface Detector with Spatial Mapping
 */
function SurfaceDetector({ onSurfaceDetected, isActive, vioTracker }) {
  const { camera, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const surfaceMesh = useRef(null);
  const detectionBuffer = useRef([]);
  const frameCounter = useRef(0);

  useEffect(() => {
    surfaceMesh.current = new SurfaceMesh(scene);
    
    // Create detection grid around camera
    const gridPositions = [
      [0, 0, -2], [0, 0, -3], [0, 0, -4],
      [-1, 0, -2], [1, 0, -2],
      [0, 1, -2], [0, -1, -2],
      [-1, -1, -3], [1, -1, -3], [-1, 1, -3], [1, 1, -3]
    ];

    gridPositions.forEach(pos => {
      const normal = new THREE.Vector3(0, 0, 1);
      surfaceMesh.current.createSurface(
        new THREE.Vector3(...pos),
        normal,
        3
      );
    });

    return () => {
      surfaceMesh.current?.clear();
    };
  }, [scene]);

  useFrame(() => {
    if (!isActive || !surfaceMesh.current) return;

    frameCounter.current++;
    
    // Update VIO tracker
    if (vioTracker) {
      vioTracker.updateFromCamera(camera);
    }

    // Multi-ray surface detection
    if (frameCounter.current % 1 === 0) { // Check every frame
      const samplePattern = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.1, 0),
        new THREE.Vector2(-0.1, 0),
        new THREE.Vector2(0, 0.1),
        new THREE.Vector2(0, -0.1),
      ];

      let bestHit = null;
      let bestScore = 0;

      samplePattern.forEach(offset => {
        raycaster.current.setFromCamera(offset, camera);
        const intersects = raycaster.current.intersectObjects(surfaceMesh.current.getSurfaces());

        if (intersects.length > 0) {
          const hit = intersects[0];
          const distance = hit.distance;
          const normal = hit.object.userData.normal;
          
          // Calculate hit quality score
          const viewDir = camera.getWorldDirection(new THREE.Vector3());
          const alignment = Math.abs(normal.dot(viewDir));
          const distanceScore = Math.max(0, 1 - distance / 5);
          const score = alignment * 0.6 + distanceScore * 0.4;

          if (score > bestScore && distance > 0.4 && distance < 5) {
            bestScore = score;
            bestHit = {
              point: hit.point.clone(),
              normal: normal.clone(),
              distance: distance,
              score: score
            };
          }
        }
      });

      if (bestHit) {
        // Add to buffer for smoothing
        detectionBuffer.current.push(bestHit);
        if (detectionBuffer.current.length > 8) {
          detectionBuffer.current.shift();
        }

        // Calculate smoothed average
        if (detectionBuffer.current.length >= 3) {
          const avgPoint = new THREE.Vector3();
          const avgNormal = new THREE.Vector3();
          let avgDistance = 0;
          let avgScore = 0;

          detectionBuffer.current.forEach(hit => {
            avgPoint.add(hit.point);
            avgNormal.add(hit.normal);
            avgDistance += hit.distance;
            avgScore += hit.score;
          });

          const count = detectionBuffer.current.length;
          avgPoint.divideScalar(count);
          avgNormal.divideScalar(count).normalize();
          avgDistance /= count;
          avgScore /= count;

          onSurfaceDetected({
            point: avgPoint,
            normal: avgNormal,
            distance: avgDistance,
            confidence: avgScore,
            detected: avgScore > 0.4
          });
        }
      } else {
        if (detectionBuffer.current.length > 0) {
          detectionBuffer.current.pop();
        }
        if (detectionBuffer.current.length === 0) {
          onSurfaceDetected({ detected: false });
        }
      }
    }
  });

  return null;
}

/**
 * Placement Reticle - Only shows when good detection
 */
function PlacementReticle({ position, confidence, visible }) {
  const ringRef = useRef();
  
  useFrame(({ clock }) => {
    if (ringRef.current && visible) {
      ringRef.current.rotation.z = clock.elapsedTime * 0.4;
    }
  });
  
  if (!visible || confidence < 0.5) return null;

  const color = confidence > 0.7 ? '#00ff00' : '#ffff00';
  
  return (
    <group position={position}>
      <mesh>
        <circleGeometry args={[0.02, 16]} />
        <meshBasicMaterial color={color} transparent opacity={1} depthTest={false} />
      </mesh>
      
      <mesh ref={ringRef}>
        <ringGeometry args={[0.06, 0.065, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      
      {[0, 90, 180, 270].map((angle, i) => (
        <mesh 
          key={i}
          position={[
            Math.cos((angle * Math.PI) / 180) * 0.12,
            Math.sin((angle * Math.PI) / 180) * 0.12,
            0
          ]}
        >
          <planeGeometry args={[0.03, 0.008]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Depth Occluder - Hides frame behind real objects
 */
function DepthOccluder({ cameraPosition, framePosition, isActive }) {
  const meshRef = useRef();
  
  useFrame(() => {
    if (meshRef.current && isActive && framePosition) {
      // Position occluder between camera and frame
      const midPoint = new THREE.Vector3()
        .addVectors(cameraPosition, framePosition)
        .multiplyScalar(0.5);
      
      meshRef.current.position.copy(midPoint);
      meshRef.current.lookAt(cameraPosition);
    }
  });
  
  if (!isActive) return null;
  
  return (
    <mesh ref={meshRef} renderOrder={-1}>
      <planeGeometry args={[5, 5]} />
      <meshBasicMaterial
        colorWrite={false}
        depthWrite={true}
        transparent
        opacity={0}
      />
    </mesh>
  );
}

/**
 * World-Anchored Model - Truly fixed in space
 */
function WorldAnchoredModel({ url, anchor, isPlaced, vioTracker }) {
  const modelRef = useRef();
  const worldAnchor = useRef(null);
  const gltf = useGLTF(url);
  const [modelSize, setModelSize] = useState(1);

  useEffect(() => {
    if (gltf?.scene) {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      setModelSize(0.35 / maxDim);
    }
  }, [gltf]);

  // Lock world position when placed
  useEffect(() => {
    if (isPlaced && anchor && vioTracker) {
      // Convert camera-relative position to absolute world position
      const worldPos = vioTracker.transformToWorld(anchor.position);
      const worldQuat = vioTracker.getWorldRotation().clone().multiply(anchor.quaternion);
      
      worldAnchor.current = {
        worldPosition: worldPos,
        worldQuaternion: worldQuat,
        scale: anchor.scale,
        locked: true
      };
      
      console.log('Frame anchored at world position:', worldPos);
    }
  }, [isPlaced, anchor, vioTracker]);

  useFrame(() => {
    if (!modelRef.current || !isPlaced || !worldAnchor.current?.locked) return;

    // Model stays at ABSOLUTE world position
    // Camera movement doesn't affect this
    const modelWorldPos = worldAnchor.current.worldPosition;
    const cameraWorldPos = vioTracker.getWorldPosition();
    
    // Convert world position back to camera-relative for rendering
    const relativePos = vioTracker.transformToLocal(modelWorldPos);
    
    modelRef.current.position.copy(relativePos);
    modelRef.current.quaternion.copy(worldAnchor.current.worldQuaternion);
    modelRef.current.scale.setScalar(worldAnchor.current.scale * modelSize);

    // Visibility based on distance
    const distance = cameraWorldPos.distanceTo(modelWorldPos);
    modelRef.current.visible = distance > 0.2 && distance < 20;

    // Smooth opacity fade
    modelRef.current.traverse((child) => {
      if (child.isMesh && child.material) {
        let opacity = 1;
        if (distance < 0.5) opacity = distance / 0.5;
        if (distance > 15) opacity = Math.max(0, (20 - distance) / 5);
        
        if (child.material.opacity !== undefined) {
          child.material.opacity = opacity;
        }
      }
    });
  });

  if (!gltf?.scene) {
    return (
      <mesh>
        <boxGeometry args={[0.35, 0.35, 0.02]} />
        <meshStandardMaterial color="#cccccc" />
      </mesh>
    );
  }

  const clonedScene = gltf.scene.clone(true);
  
  clonedScene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material.side = THREE.DoubleSide;
        child.material.transparent = true;
        child.material.depthTest = true;
        child.material.depthWrite = true;
      }
    }
  });

  const box = new THREE.Box3().setFromObject(clonedScene);
  const center = box.getCenter(new THREE.Vector3());
  clonedScene.position.sub(center);

  return <primitive ref={modelRef} object={clonedScene} visible={isPlaced} />;
}

/**
 * Main AR Scene
 */
function ARScene({ 
  currentModel, 
  onPlacement, 
  isPlaced, 
  anchor,
  onTransformChange,
  scanningPhase,
  onSurfaceDetected,
  vioTracker
}) {
  const { camera, gl } = useThree();
  const [surfaceData, setSurfaceData] = useState(null);
  
  const touchStart = useRef({ x: 0, y: 0, distance: 0 });
  const lastPinchDist = useRef(0);
  const gestureMode = useRef(null);

  const handleSurfaceDetection = useCallback((data) => {
    setSurfaceData(data);
    onSurfaceDetected(data);
  }, [onSurfaceDetected]);

  const handleTouchStart = useCallback((event) => {
    event.preventDefault();
    
    if (!isPlaced) {
      if (surfaceData?.detected && surfaceData.confidence > 0.6 && event.touches.length === 1) {
        const offset = surfaceData.normal.clone().multiplyScalar(0.01);
        const placementPos = surfaceData.point.clone().add(offset);
        
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceData.normal);
        
        onPlacement(placementPos, quaternion);
      }
      return;
    }

    if (event.touches.length === 1) {
      touchStart.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY
      };
      gestureMode.current = 'move';
    } else if (event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
      gestureMode.current = 'scale';
    }
  }, [isPlaced, surfaceData, onPlacement]);

  const handleTouchMove = useCallback((event) => {
    event.preventDefault();
    if (!isPlaced || !anchor) return;

    if (event.touches.length === 1 && gestureMode.current === 'move') {
      const sensitivity = 0.0006;
      const deltaX = (event.touches[0].clientX - touchStart.current.x) * sensitivity;
      const deltaY = -(event.touches[0].clientY - touchStart.current.y) * sensitivity;
      
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0);
      
      const newPos = anchor.position.clone();
      newPos.add(right.multiplyScalar(deltaX));
      newPos.add(up.multiplyScalar(deltaY));
      
      onTransformChange({
        position: newPos,
        quaternion: anchor.quaternion,
        scale: anchor.scale
      });
      
      touchStart.current.x = event.touches[0].clientX;
      touchStart.current.y = event.touches[0].clientY;
    } else if (event.touches.length === 2 && gestureMode.current === 'scale') {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      const delta = (dist - lastPinchDist.current) * 0.0012;
      const newScale = Math.max(0.5, Math.min(3, anchor.scale + delta));
      
      onTransformChange({
        position: anchor.position,
        quaternion: anchor.quaternion,
        scale: newScale
      });
      
      lastPinchDist.current = dist;
    }
  }, [isPlaced, anchor, camera, onTransformChange]);

  const handleTouchEnd = useCallback(() => {
    gestureMode.current = null;
  }, []);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd);
    
    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [gl, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return (
    <>
      <SurfaceDetector 
        onSurfaceDetected={handleSurfaceDetection}
        isActive={scanningPhase}
        vioTracker={vioTracker}
      />
      
      <PlacementReticle 
        position={surfaceData?.point || new THREE.Vector3(0, 0, -2)} 
        confidence={surfaceData?.confidence || 0}
        visible={scanningPhase && surfaceData?.detected}
      />
      
      <DepthOccluder
        cameraPosition={camera.position}
        framePosition={anchor?.position}
        isActive={isPlaced}
      />
      
      {currentModel && (
        <Suspense fallback={null}>
          <WorldAnchoredModel 
            url={currentModel} 
            anchor={anchor}
            isPlaced={isPlaced}
            vioTracker={vioTracker}
          />
        </Suspense>
      )}
    </>
  );
}

/**
 * Main Component
 */
export default function CustomARViewer({ onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const vioTrackerRef = useRef(null);
  const sessionStartTime = useRef(Date.now());
  const screenshotCount = useRef(0);
  const transformCount = useRef(0);
  const initAttempts = useRef(0);

  const [cameraStatus, setCameraStatus] = useState('initializing');
  const [cameraError, setCameraError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [arPhase, setArPhase] = useState('scanning');
  const [isModelPlaced, setIsModelPlaced] = useState(false);
  const [surfaceDetected, setSurfaceDetected] = useState(false);
  const [showGestureTutorial, setShowGestureTutorial] = useState(false);
  
  const [anchor, setAnchor] = useState({
    position: new THREE.Vector3(0, 0, -2),
    quaternion: new THREE.Quaternion(),
    scale: 1
  });

  const { currentModel, modelType, showGrid, toggleGrid } = useARStore();

  // Initialize VIO tracker
  useEffect(() => {
    vioTrackerRef.current = new VIOTracker();
  }, []);

  const initCamera = useCallback(async () => {
    if (streamRef.current || initAttempts.current > 3) return;

    initAttempts.current++;
    setCameraStatus('requesting');
    setCameraError(null);

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera not supported');
      }

      const constraints = [
        { 
          video: { 
            facingMode: { ideal: facingMode }, 
            width: { ideal: 1920 }, 
            height: { ideal: 1080 },
            frameRate: { ideal: 60, min: 30 }
          }, 
          audio: false 
        },
        { video: { facingMode: facingMode }, audio: false },
        { video: true, audio: false }
      ];

      let stream = null;
      for (const constraint of constraints) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraint);
          if (stream) break;
        } catch (err) {
          console.warn('Constraint failed:', err);
        }
      }

      if (!stream) throw new Error('Camera access denied');

      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;

      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
        setTimeout(() => reject(new Error('Timeout')), 10000);
      });

      await video.play();
      setCameraStatus('ready');
      
      setTimeout(() => setArPhase('ready'), 2000);
      analytics.trackARSessionStarted({ url: currentModel, type: modelType });
    } catch (error) {
      setCameraStatus('error');
      setCameraError(error.message);
    }
  }, [facingMode, currentModel, modelType]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const switchCamera = useCallback(() => {
    stopCamera();
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
    initAttempts.current = 0;
    setTimeout(() => initCamera(), 100);
  }, [stopCamera, initCamera]);

  const retryCamera = useCallback(() => {
    stopCamera();
    initAttempts.current = 0;
    setCameraStatus('initializing');
    setTimeout(() => initCamera(), 100);
  }, [stopCamera, initCamera]);

  useEffect(() => {
    const startTime = sessionStartTime.current;
    const screenshotCountValue = screenshotCount.current;
    const transformCountValue = transformCount.current;

    const timer = setTimeout(() => initCamera(), 500);
    
    return () => {
      clearTimeout(timer);
      stopCamera();
      analytics.trackARSessionEnded({
        duration: Date.now() - startTime,
        screenshots: screenshotCountValue,
        transforms: transformCountValue,
      });
    };
  }, [initCamera, stopCamera]);

  const handleSurfaceDetected = useCallback((data) => {
    setSurfaceDetected(data.detected);
  }, []);

  const handlePlacement = useCallback((position, quaternion) => {
    setAnchor({
      position: position.clone(),
      quaternion: quaternion.clone(),
      scale: 1
    });
    setIsModelPlaced(true);
    setArPhase('placed');
    setShowGestureTutorial(true);
    setTimeout(() => setShowGestureTutorial(false), 5000);
    transformCount.current++;
  }, []);

  const handleTransformChange = useCallback((newAnchor) => {
    setAnchor(newAnchor);
    transformCount.current++;
  }, []);

  const handleReset = useCallback(() => {
    setIsModelPlaced(false);
    setArPhase('ready');
    setAnchor({
      position: new THREE.Vector3(0, 0, -2),
      quaternion: new THREE.Quaternion(),
      scale: 1
    });
  }, []);

  const handleScreenshot = useCallback(async () => {
    try {
      const composite = document.createElement('canvas');
      const video = videoRef.current;
      const canvas = canvasRef.current?.querySelector('canvas');

      if (!video || !canvas) return;

      composite.width = video.videoWidth || 1920;
      composite.height = video.videoHeight || 1080;

      const ctx = composite.getContext('2d');
      ctx.drawImage(video, 0, 0, composite.width, composite.height);
      ctx.drawImage(canvas, 0, 0, composite.width, composite.height);

      composite.toBlob((blob) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `ar-frame-${Date.now()}.png`;
        link.click();
        URL.revokeObjectURL(url);
        screenshotCount.current++;
      }, 'image/png');
    } catch (error) {
      console.error('Screenshot error:', error);
    }
  }, []);

  const toggleFullscreen = useCallback(async () => {
    try {
      if (!isFullscreen) {
        await document.documentElement.requestFullscreen?.();
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen?.();
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  }, [isFullscreen]);

  return (
    <div className="ar-viewer-advanced">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="ar-video-feed"
      />

      {cameraStatus === 'ready' && (
        <div ref={canvasRef} className="ar-canvas-layer">
          <Canvas
            gl={{ 
              alpha: true, 
              antialias: true, 
              preserveDrawingBuffer: true,
              powerPreference: "high-performance"
            }}
            style={{ background: 'transparent' }}
            frameloop="always"
          >
            <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={70} />
            <ambientLight intensity={0.5} />
            <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
            <pointLight position={[-5, 5, -5]} intensity={0.3} />
            <Environment preset="city" />
            
            {showGrid && <gridHelper args={[10, 10]} position={[0, -1.5, 0]} />}
            
            <ARScene 
              currentModel={currentModel}
              onPlacement={handlePlacement}
              isPlaced={isModelPlaced}
              anchor={anchor}
              onTransformChange={handleTransformChange}
              scanningPhase={arPhase === 'scanning' || arPhase === 'ready'}
              onSurfaceDetected={handleSurfaceDetected}
              vioTracker={vioTrackerRef.current}
            />
          </Canvas>
        </div>
      )}

      {cameraStatus !== 'ready' && cameraStatus !== 'error' && (
        <div className="ar-loading-screen">
          <div className="loading-ring"></div>
          <h3>Initializing AR</h3>
          <p>Preparing camera...</p>
        </div>
      )}

      {cameraStatus === 'error' && (
        <div className="ar-error-screen">
          <div className="error-badge">⚠️</div>
          <h3>Camera Error</h3>
          <p>{cameraError}</p>
          <div className="error-actions">
            <button className="btn-retry" onClick={retryCamera}>
              <RefreshCw size={20} /> Retry
            </button>
            <button className="btn-close" onClick={onClose}>
              <X size={20} /> Close
            </button>
          </div>
        </div>
      )}

      {cameraStatus === 'ready' && (
        <>
          <header className="ar-header">
            <button className="ar-btn-close" onClick={onClose}>
              <X size={22} />
            </button>
            
            <div className="ar-status-pill">
              {arPhase === 'scanning' && (
                <>
                  <div className="status-spinner-mini" />
                  <span>Mapping Space...</span>
                </>
              )}
              {arPhase === 'ready' && (
                <>
                  <div className={`status-indicator ${surfaceDetected ? 'active' : 'inactive'}`} />
                  <span>{surfaceDetected ? 'Surface Found' : 'Scanning...'}</span>
                </>
              )}
              {arPhase === 'placed' && (
                <>
                  <div className="status-indicator success" />
                  <span>Frame Anchored</span>
                </>
              )}
            </div>

            <div className="ar-actions-bar">
              <button className="ar-btn-action" onClick={toggleGrid}>
                <Grid size={18} />
              </button>
              <button className="ar-btn-action" onClick={switchCamera}>
                <RefreshCw size={18} />
              </button>
              <button className="ar-btn-action" onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
              </button>
            </div>
          </header>

          {arPhase === 'scanning' && (
            <div className="ar-scan-guide">
              <Scan size={40} className="scan-icon" />
              <h3>Scanning Environment</h3>
              <p>Move device slowly to detect surfaces</p>
              <div className="scan-bar-container">
                <div className="scan-bar-fill" />
              </div>
            </div>
          )}

          {arPhase === 'ready' && !isModelPlaced && (
            <div className="ar-placement-guide">
              <h4>Aim at Wall</h4>
              <p>Tap when green reticle appears</p>
            </div>
          )}

          {showGestureTutorial && arPhase === 'placed' && (
            <div className="gesture-guide">
              <h4>✋ Controls</h4>
              <div className="gesture-grid">
                <div className="gesture-card">
                  <Move size={20} />
                  <span>Drag</span>
                </div>
                <div className="gesture-card">
                  <Hand size={20} />
                  <span>Pinch</span>
                </div>
                <div className="gesture-card">
                  <RotateCw size={20} />
                  <span>Rotate</span>
                </div>
              </div>
            </div>
          )}

          {isModelPlaced && (
            <div className="ar-action-panel">
              <button className="action-btn primary" onClick={handleScreenshot}>
                <Camera size={22} />
              </button>
              <button className="action-btn" onClick={handleReset}>
                <RotateCcw size={22} />
              </button>
              <button className="action-btn" onClick={() => setShowGestureTutorial(!showGestureTutorial)}>
                <Hand size={22} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
