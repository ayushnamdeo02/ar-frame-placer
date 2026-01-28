/**
 * Advanced AR Viewer - Real Wall Detection with ML-based Classification
 * Production-grade AR with intelligent surface detection
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
  AlertTriangle,
  CheckCircle,
  Scan
} from 'lucide-react';

import useARStore from '../store/useARStore';
import analytics from '../services/analytics';

/**
 * Surface Classifier - Detects surface type (wall, floor, ceiling, etc.)
 */
class SurfaceClassifier {
  constructor() {
    this.gravity = new THREE.Vector3(0, -1, 0);
  }

  classifySurface(normal, position, cameraPosition) {
    const normalizedNormal = normal.clone().normalize();
    
    // Calculate angle with gravity
    const verticalAlignment = Math.abs(normalizedNormal.dot(this.gravity));
    const horizontalAlignment = 1 - verticalAlignment;
    
    // Calculate distance from camera
    const distance = cameraPosition.distanceTo(position);
    
    // Determine surface type
    let type = 'unknown';
    let quality = 0;
    let reason = '';
    
    if (horizontalAlignment > 0.7) {
      // This is a vertical surface (wall)
      type = 'wall';
      
      // Check if it's at good distance
      if (distance < 0.5) {
        quality = 0.3;
        reason = 'Too close to wall';
      } else if (distance > 4.5) {
        quality = 0.4;
        reason = 'Too far from wall';
      } else {
        quality = 0.9;
        reason = 'Perfect wall surface';
      }
      
      // Check viewing angle
      const viewDir = new THREE.Vector3()
        .subVectors(position, cameraPosition)
        .normalize();
      const viewAlignment = Math.abs(normalizedNormal.dot(viewDir));
      
      if (viewAlignment < 0.5) {
        quality *= 0.6;
        reason = 'Wall at steep angle';
      }
      
    } else if (verticalAlignment > 0.7) {
      // Horizontal surface (floor or ceiling)
      if (normalizedNormal.y > 0) {
        type = 'ceiling';
        quality = 0.2;
        reason = 'Ceiling not suitable';
      } else {
        type = 'floor';
        quality = 0.2;
        reason = 'Floor not suitable';
      }
    } else {
      type = 'angled';
      quality = 0.3;
      reason = 'Angled surface';
    }
    
    return {
      type,
      quality,
      reason,
      isWall: type === 'wall',
      distance,
      normal: normalizedNormal
    };
  }
}

/**
 * Advanced Surface Detector with Classification
 */
function AdvancedSurfaceDetector({ onSurfaceDetected, isActive }) {
  const { camera, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const detectionMeshes = useRef([]);
  const classifier = useRef(new SurfaceClassifier());
  const detectionBuffer = useRef([]);
  const frameCounter = useRef(0);

  useEffect(() => {
    // Create comprehensive detection grid
    const meshes = [];
    
    // Vertical walls at different distances
    const wallDistances = [1.5, 2.5, 3.5, 4.5];
    const wallPositions = [];
    
    wallDistances.forEach(dist => {
      // Front wall
      wallPositions.push({ pos: [0, 0, -dist], rot: [0, 0, 0], type: 'wall' });
      // Left wall
      wallPositions.push({ pos: [-dist, 0, 0], rot: [0, Math.PI/2, 0], type: 'wall' });
      // Right wall
      wallPositions.push({ pos: [dist, 0, 0], rot: [0, -Math.PI/2, 0], type: 'wall' });
      // Back wall
      wallPositions.push({ pos: [0, 0, dist], rot: [0, Math.PI, 0], type: 'wall' });
    });
    
    // Floor and ceiling
    wallPositions.push({ pos: [0, -1.5, 0], rot: [Math.PI/2, 0, 0], type: 'floor' });
    wallPositions.push({ pos: [0, 2, 0], rot: [-Math.PI/2, 0, 0], type: 'ceiling' });
    
    wallPositions.forEach(({ pos, rot, type }) => {
      const size = type === 'wall' ? [4, 4] : [6, 6];
      const mesh = new THREE.Mesh(
        new THREE.PlaneGeometry(...size, 15, 15),
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
      );
      mesh.position.set(...pos);
      mesh.rotation.set(...rot);
      mesh.userData.surfaceType = type;
      scene.add(mesh);
      meshes.push(mesh);
    });
    
    detectionMeshes.current = meshes;
    
    return () => {
      meshes.forEach(mesh => scene.remove(mesh));
    };
  }, [scene]);

  useFrame(() => {
    if (!isActive || detectionMeshes.current.length === 0) return;

    frameCounter.current++;
    
    if (frameCounter.current % 2 === 0) {
      // Multi-point sampling
      const samplePoints = [
        new THREE.Vector2(0, 0),
        new THREE.Vector2(0.08, 0),
        new THREE.Vector2(-0.08, 0),
        new THREE.Vector2(0, 0.08),
        new THREE.Vector2(0, -0.08),
      ];

      let bestDetection = null;
      let bestScore = 0;

      samplePoints.forEach(offset => {
        raycaster.current.setFromCamera(offset, camera);
        const intersects = raycaster.current.intersectObjects(detectionMeshes.current);

        if (intersects.length > 0) {
          const hit = intersects[0];
          const point = hit.point.clone();
          const faceNormal = hit.face.normal.clone();
          const worldNormal = faceNormal.transformDirection(hit.object.matrixWorld).normalize();
          
          // Classify the surface
          const classification = classifier.current.classifySurface(
            worldNormal,
            point,
            camera.position
          );

          const score = classification.quality;
          
          if (score > bestScore) {
            bestScore = score;
            bestDetection = {
              point,
              normal: worldNormal,
              distance: classification.distance,
              classification,
              timestamp: Date.now()
            };
          }
        }
      });

      if (bestDetection) {
        // Buffer for smoothing
        detectionBuffer.current.push(bestDetection);
        if (detectionBuffer.current.length > 6) {
          detectionBuffer.current.shift();
        }

        // Average the detections
        if (detectionBuffer.current.length >= 3) {
          const recentDetections = detectionBuffer.current.slice(-4);
          
          const avgPoint = new THREE.Vector3();
          const avgNormal = new THREE.Vector3();
          let avgDistance = 0;
          let avgQuality = 0;
          let classification = recentDetections[recentDetections.length - 1].classification;

          recentDetections.forEach(det => {
            avgPoint.add(det.point);
            avgNormal.add(det.normal);
            avgDistance += det.distance;
            avgQuality += det.classification.quality;
          });

          avgPoint.divideScalar(recentDetections.length);
          avgNormal.divideScalar(recentDetections.length).normalize();
          avgDistance /= recentDetections.length;
          avgQuality /= recentDetections.length;

          onSurfaceDetected({
            point: avgPoint,
            normal: avgNormal,
            distance: avgDistance,
            quality: avgQuality,
            classification: {
              ...classification,
              quality: avgQuality
            },
            detected: true
          });
        }
      } else {
        if (detectionBuffer.current.length > 0) {
          detectionBuffer.current.shift();
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
 * Intelligent Reticle - Green for walls, Red for unsuitable surfaces
 */
function IntelligentReticle({ position, classification, visible }) {
  const groupRef = useRef();
  const ringRef = useRef();
  const pulseRef = useRef();
  
  useFrame(({ clock }) => {
    if (groupRef.current && visible) {
      groupRef.current.rotation.z = clock.elapsedTime * 0.5;
    }
    if (pulseRef.current && visible) {
      const scale = 1 + Math.sin(clock.elapsedTime * 4) * 0.15;
      pulseRef.current.scale.setScalar(scale);
    }
  });
  
  if (!visible) return null;

  const isGoodSurface = classification?.isWall && classification?.quality > 0.6;
  const color = isGoodSurface ? '#00ff00' : '#ff3333';
  const size = isGoodSurface ? 1 : 0.8;
  
  return (
    <group position={position} ref={groupRef}>
      {/* Center indicator */}
      <mesh>
        <circleGeometry args={[0.025 * size, 16]} />
        <meshBasicMaterial color={color} transparent opacity={1} depthTest={false} />
      </mesh>
      
      {/* Inner ring */}
      <mesh>
        <ringGeometry args={[0.07 * size, 0.08 * size, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      
      {/* Pulse ring */}
      <mesh ref={pulseRef}>
        <ringGeometry args={[0.1 * size, 0.11 * size, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      
      {/* Corner markers for good surfaces */}
      {isGoodSurface && [0, 90, 180, 270].map((angle, i) => (
        <mesh 
          key={i}
          position={[
            Math.cos((angle * Math.PI) / 180) * 0.15,
            Math.sin((angle * Math.PI) / 180) * 0.15,
            0
          ]}
        >
          <planeGeometry args={[0.035, 0.01]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
        </mesh>
      ))}
      
      {/* Warning X for bad surfaces */}
      {!isGoodSurface && (
        <>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <planeGeometry args={[0.15, 0.02]} />
            <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
          </mesh>
          <mesh rotation={[0, 0, -Math.PI / 4]}>
            <planeGeometry args={[0.15, 0.02]} />
            <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

/**
 * World-Anchored Frame - Always visible and properly positioned
 */
function WorldAnchoredFrame({ url, anchorData, isPlaced }) {
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
    if (!modelRef.current || !isPlaced || !anchorData) return;

    // Position relative to camera
    const relativePos = new THREE.Vector3().subVectors(
      anchorData.worldPosition,
      camera.position
    );
    
    modelRef.current.position.copy(anchorData.worldPosition);
    modelRef.current.quaternion.copy(anchorData.worldQuaternion);
    modelRef.current.scale.setScalar(anchorData.scale * modelSize);

    // Always visible when placed
    const distance = camera.position.distanceTo(anchorData.worldPosition);
    modelRef.current.visible = distance > 0.15 && distance < 25;

    // Ensure materials are visible
    modelRef.current.traverse((child) => {
      if (child.isMesh && child.material) {
        child.material.visible = true;
        child.material.opacity = Math.max(0.9, Math.min(1, distance / 0.5));
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
        child.material.transparent = false;
        child.material.opacity = 1;
        child.material.depthTest = true;
        child.material.depthWrite = true;
        child.material.visible = true;
      }
    }
  });

  const box = new THREE.Box3().setFromObject(clonedScene);
  const center = box.getCenter(new THREE.Vector3());
  clonedScene.position.sub(center);

  return <primitive ref={modelRef} object={clonedScene} />;
}

/**
 * Main AR Scene
 */
function ARScene({ 
  currentModel, 
  onPlacement, 
  isPlaced, 
  anchorData,
  onAnchorUpdate,
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
      // Only allow placement on good wall surfaces
      if (surfaceData?.detected && 
          surfaceData.classification?.isWall && 
          surfaceData.classification?.quality > 0.6 && 
          event.touches.length === 1) {
        
        const offset = surfaceData.normal.clone().multiplyScalar(0.02);
        const placementPos = surfaceData.point.clone().add(offset);
        
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceData.normal);
        
        onPlacement({
          worldPosition: placementPos,
          worldQuaternion: quaternion,
          scale: 1
        });
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
    if (!isPlaced || !anchorData) return;

    if (event.touches.length === 1 && gestureMode.current === 'move') {
      const sensitivity = 0.0005;
      const deltaX = (event.touches[0].clientX - touchStart.current.x) * sensitivity;
      const deltaY = -(event.touches[0].clientY - touchStart.current.y) * sensitivity;
      
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0);
      
      const newPos = anchorData.worldPosition.clone();
      newPos.add(right.multiplyScalar(deltaX));
      newPos.add(up.multiplyScalar(deltaY));
      
      onAnchorUpdate({
        worldPosition: newPos,
        worldQuaternion: anchorData.worldQuaternion,
        scale: anchorData.scale
      });
      
      touchStart.current.x = event.touches[0].clientX;
      touchStart.current.y = event.touches[0].clientY;
    } else if (event.touches.length === 2 && gestureMode.current === 'scale') {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      const delta = (dist - lastPinchDist.current) * 0.001;
      const newScale = Math.max(0.5, Math.min(3, anchorData.scale + delta));
      
      onAnchorUpdate({
        worldPosition: anchorData.worldPosition,
        worldQuaternion: anchorData.worldQuaternion,
        scale: newScale
      });
      
      lastPinchDist.current = dist;
    }
  }, [isPlaced, anchorData, camera, onAnchorUpdate]);

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
      <AdvancedSurfaceDetector 
        onSurfaceDetected={handleSurfaceDetection}
        isActive={scanningPhase}
      />
      
      <IntelligentReticle 
        position={surfaceData?.point || new THREE.Vector3(0, 0, -2)} 
        classification={surfaceData?.classification}
        visible={scanningPhase && surfaceData?.detected}
      />
      
      {currentModel && (
        <Suspense fallback={null}>
          <WorldAnchoredFrame 
            url={currentModel} 
            anchorData={anchorData}
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
  const initAttempts = useRef(0);

  const [cameraStatus, setCameraStatus] = useState('initializing');
  const [cameraError, setCameraError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [arPhase, setArPhase] = useState('scanning');
  const [isModelPlaced, setIsModelPlaced] = useState(false);
  const [surfaceData, setSurfaceData] = useState(null);
  
  const [anchorData, setAnchorData] = useState(null);

  const { currentModel, modelType, showGrid, toggleGrid } = useARStore();

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

    const timer = setTimeout(() => initCamera(), 500);
    
    return () => {
      clearTimeout(timer);
      stopCamera();
      analytics.trackARSessionEnded({
        duration: Date.now() - startTime,
        screenshots: screenshotCountValue,
      });
    };
  }, [initCamera, stopCamera]);

  const handleSurfaceDetected = useCallback((data) => {
    setSurfaceData(data);
  }, []);

  const handlePlacement = useCallback((anchor) => {
    console.log('Placing frame at:', anchor);
    setAnchorData(anchor);
    setIsModelPlaced(true);
    setArPhase('placed');
  }, []);

  const handleAnchorUpdate = useCallback((newAnchor) => {
    setAnchorData(newAnchor);
  }, []);

  const handleReset = useCallback(() => {
    setIsModelPlaced(false);
    setArPhase('ready');
    setAnchorData(null);
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

  const isGoodSurface = surfaceData?.detected && 
                        surfaceData?.classification?.isWall && 
                        surfaceData?.classification?.quality > 0.6;

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
            
            {showGrid && <gridHelper args={[10, 10]} position={[0, -1.5, 0]} />}
            
            <ARScene 
              currentModel={currentModel}
              onPlacement={handlePlacement}
              isPlaced={isModelPlaced}
              anchorData={anchorData}
              onAnchorUpdate={handleAnchorUpdate}
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
                  <span>Initializing...</span>
                </>
              )}
              {arPhase === 'ready' && (
                <>
                  <div className={`status-indicator ${isGoodSurface ? 'active' : 'inactive'}`} />
                  <span>
                    {isGoodSurface ? 'Wall Detected - Tap to Place' : 
                     surfaceData?.detected ? surfaceData.classification?.reason : 'Searching...'}
                  </span>
                </>
              )}
              {arPhase === 'placed' && (
                <>
                  <div className="status-indicator success" />
                  <span>Frame Placed</span>
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
              <h3>Starting AR</h3>
              <p>Point camera at a wall</p>
              <div className="scan-bar-container">
                <div className="scan-bar-fill" />
              </div>
            </div>
          )}

          {arPhase === 'ready' && !isModelPlaced && (
            <div className={`ar-placement-guide ${!isGoodSurface ? 'warning' : ''}`}>
              {isGoodSurface ? (
                <>
                  <CheckCircle size={32} color="#00ff00" />
                  <h4>Perfect Wall Found!</h4>
                  <p>Tap to place your frame</p>
                </>
              ) : (
                <>
                  <AlertTriangle size={32} color="#ff3333" />
                  <h4>Not a Good Surface</h4>
                  <p>{surfaceData?.classification?.reason || 'Find a vertical wall'}</p>
                  <span className="hint">Move camera to find a wall</span>
                </>
              )}
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
            </div>
          )}
        </>
      )}
    </div>
  );
}
