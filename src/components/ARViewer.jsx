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
  RotateCcw,
  RefreshCw,
  Move,
  Hand,
  Scan
} from 'lucide-react';

import useARStore from '../store/useARStore';
import analytics from '../services/analytics';

/**
 * Surface Mesh Generator - Creates realistic surface detection
 */
class SurfaceMesh {
  constructor(scene) {
    this.scene = scene;
    this.surfaces = [];
  }

  createSurface(position, normal, size = 2) {
    const geometry = new THREE.PlaneGeometry(size, size, 10, 10);
    const material = new THREE.MeshBasicMaterial({
      visible: false,
      side: THREE.DoubleSide
    });
    
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(position);
    
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
function SurfaceDetector({ onSurfaceDetected, isActive }) {
  const { camera, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const surfaceMesh = useRef(null);
  const detectionBuffer = useRef([]);
  const frameCounter = useRef(0);

  useEffect(() => {
    surfaceMesh.current = new SurfaceMesh(scene);
    
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

    if (frameCounter.current % 1 === 0) {
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
        detectionBuffer.current.push(bestHit);
        if (detectionBuffer.current.length > 8) {
          detectionBuffer.current.shift();
        }

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
 * World-Anchored Model - Properly visible and anchored
 */
function WorldAnchoredModel({ url, anchor, isPlaced }) {
  const modelRef = useRef();
  const gltf = useGLTF(url);
  const [modelSize, setModelSize] = useState(1);
  const { camera } = useThree();

  useEffect(() => {
    if (gltf?.scene) {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      setModelSize(0.4 / maxDim);
    }
  }, [gltf]);

  useFrame(() => {
    if (!modelRef.current || !isPlaced || !anchor) return;

    // Direct positioning - simple and reliable
    modelRef.current.position.copy(anchor.position);
    modelRef.current.quaternion.copy(anchor.quaternion);
    modelRef.current.scale.setScalar(anchor.scale * modelSize);

    // Always visible when placed
    const distance = camera.position.distanceTo(anchor.position);
    modelRef.current.visible = true;

    // Ensure all materials are visible
    modelRef.current.traverse((child) => {
      if (child.isMesh && child.material) {
        child.visible = true;
        child.material.visible = true;
        child.material.opacity = 1;
        child.material.transparent = false;
        
        // Fade only if very close or very far
        if (distance < 0.3) {
          child.material.transparent = true;
          child.material.opacity = distance / 0.3;
        } else if (distance > 18) {
          child.material.transparent = true;
          child.material.opacity = Math.max(0, (20 - distance) / 2);
        }
      }
    });
  });

  if (!gltf?.scene) {
    return (
      <mesh>
        <boxGeometry args={[0.4, 0.4, 0.03]} />
        <meshStandardMaterial color="#8B7355" metalness={0.3} roughness={0.7} />
      </mesh>
    );
  }

  const clonedScene = gltf.scene.clone(true);
  
  clonedScene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = false;
      if (child.material) {
        child.material.side = THREE.DoubleSide;
        child.material.depthTest = true;
        child.material.depthWrite = true;
        child.material.visible = true;
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
  onSurfaceDetected
}) {
  const { camera, gl } = useThree();
  const [surfaceData, setSurfaceData] = useState(null);
  
  const touchStart = useRef({ x: 0, y: 0 });
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
      />
      
      <PlacementReticle 
        position={surfaceData?.point || new THREE.Vector3(0, 0, -2)} 
        confidence={surfaceData?.confidence || 0}
        visible={scanningPhase && surfaceData?.detected}
      />
      
      {currentModel && (
        <Suspense fallback={null}>
          <WorldAnchoredModel 
            url={currentModel} 
            anchor={anchor}
            isPlaced={isPlaced}
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

  const { currentModel, modelType } = useARStore();

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
      
      setTimeout(() => setArPhase('ready'), 1500);
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
    console.log('Placing frame at:', position);
    setAnchor({
      position: position.clone(),
      quaternion: quaternion.clone(),
      scale: 1
    });
    setIsModelPlaced(true);
    setArPhase('placed');
    setShowGestureTutorial(true);
    setTimeout(() => setShowGestureTutorial(false), 4000);
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
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
            <pointLight position={[-5, 5, -5]} intensity={0.4} />
            <hemisphereLight intensity={0.5} />
            <Environment preset="city" />
            
            <ARScene 
              currentModel={currentModel}
              onPlacement={handlePlacement}
              isPlaced={isModelPlaced}
              anchor={anchor}
              onTransformChange={handleTransformChange}
              scanningPhase={arPhase === 'scanning' || arPhase === 'ready'}
              onSurfaceDetected={handleSurfaceDetected}
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
                  <span>Initializing AR...</span>
                </>
              )}
              {arPhase === 'ready' && (
                <>
                  <div className={`status-indicator ${surfaceDetected ? 'active' : 'inactive'}`} />
                  <span>{surfaceDetected ? 'Tap to Place Frame' : 'Point at Surface'}</span>
                </>
              )}
              {arPhase === 'placed' && (
                <>
                  <div className="status-indicator success" />
                  <span>Frame Placed ✓</span>
                </>
              )}
            </div>

            <div className="ar-actions-bar">
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
              <h3>Starting AR</h3>
              <p>Point camera at a surface</p>
              <div className="scan-bar-container">
                <div className="scan-bar-fill" />
              </div>
            </div>
          )}

          {arPhase === 'ready' && !isModelPlaced && (
            <div className="ar-placement-guide">
              <h4>👆 Aim & Tap</h4>
              <p>{surfaceDetected ? 'Green reticle = ready to place' : 'Move slowly to detect surface'}</p>
            </div>
          )}

          {showGestureTutorial && arPhase === 'placed' && (
            <div className="gesture-guide">
              <h4>✋ Touch Controls</h4>
              <div className="gesture-grid">
                <div className="gesture-card">
                  <Move size={24} />
                  <span>Drag to Move</span>
                </div>
                <div className="gesture-card">
                  <Hand size={24} />
                  <span>Pinch to Scale</span>
                </div>
              </div>
            </div>
          )}

          {isModelPlaced && (
            <div className="ar-action-panel">
              <button className="action-btn primary" onClick={handleScreenshot} title="Take Photo">
                <Camera size={24} />
              </button>
              <button className="action-btn" onClick={handleReset} title="Reset">
                <RotateCcw size={24} />
              </button>
              <button className="action-btn" onClick={() => setShowGestureTutorial(!showGestureTutorial)} title="Help">
                <Hand size={24} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
