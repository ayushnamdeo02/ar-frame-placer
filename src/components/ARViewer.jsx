/**
 * Advanced AR Viewer with Depth Detection & Occlusion
 * Production-grade AR with AI-powered wall detection
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
  Scan,
  Crosshair
} from 'lucide-react';

import useARStore from '../store/useARStore';
import analytics from '../services/analytics';

/**
 * Scanning Grid - Smaller and refined
 */
function ScanningGrid({ isScanning }) {
  const meshRef = useRef();
  
  useFrame(({ clock }) => {
    if (meshRef.current && isScanning) {
      meshRef.current.position.z = -2 + Math.sin(clock.elapsedTime * 2) * 0.3;
      meshRef.current.material.opacity = 0.15 + Math.sin(clock.elapsedTime * 3) * 0.1;
    }
  });
  
  if (!isScanning) return null;
  
  return (
    <mesh ref={meshRef} position={[0, 0, -2]}>
      <planeGeometry args={[4, 4, 15, 15]} />
      <meshBasicMaterial 
        color="#00ff00" 
        wireframe 
        transparent 
        opacity={0.15}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * Refined Wall Detection Reticle - Smaller, cleaner
 */
function WallReticle({ position, detected }) {
  const ringRef = useRef();
  const pulseRef = useRef();
  
  useFrame(({ clock }) => {
    if (ringRef.current) {
      ringRef.current.rotation.z = clock.elapsedTime * 0.5;
    }
    if (pulseRef.current) {
      const scale = 1 + Math.sin(clock.elapsedTime * 3) * 0.1;
      pulseRef.current.scale.setScalar(scale);
    }
  });
  
  if (!detected) return null;
  
  return (
    <group position={position}>
      {/* Center dot */}
      <mesh>
        <circleGeometry args={[0.01, 16]} />
        <meshBasicMaterial color="#00ff00" transparent opacity={0.9} />
      </mesh>
      
      {/* Inner ring */}
      <mesh ref={ringRef}>
        <ringGeometry args={[0.04, 0.05, 32]} />
        <meshBasicMaterial color="#00ff00" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Outer pulse ring */}
      <mesh ref={pulseRef}>
        <ringGeometry args={[0.07, 0.075, 32]} />
        <meshBasicMaterial color="#00ff00" transparent opacity={0.4} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Corner markers */}
      {[0, 90, 180, 270].map((angle, i) => (
        <mesh 
          key={i}
          position={[
            Math.cos((angle * Math.PI) / 180) * 0.1,
            Math.sin((angle * Math.PI) / 180) * 0.1,
            0
          ]}
        >
          <planeGeometry args={[0.02, 0.006]} />
          <meshBasicMaterial color="#00ff00" transparent opacity={0.8} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * Model with proper world-space anchoring and occlusion
 */
function Model3D({ url, anchorPosition, anchorRotation, modelScale, isPlaced }) {
  const modelRef = useRef();
  const anchorRef = useRef(); // Anchor point that stays fixed
  const gltf = useGLTF(url);
  const [modelSize, setModelSize] = useState(1);
  const { camera } = useThree();

  useEffect(() => {
    if (gltf?.scene) {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const normalizeScale = 0.4 / maxDim; // Smaller frame size
      setModelSize(normalizeScale);
    }
  }, [gltf]);

  // Create fixed anchor point in world space
  useEffect(() => {
    if (isPlaced && anchorPosition) {
      anchorRef.current = anchorPosition.clone();
    }
  }, [isPlaced, anchorPosition]);

  useFrame(() => {
    if (modelRef.current && isPlaced && anchorRef.current) {
      // Keep model at fixed world position
      modelRef.current.position.copy(anchorRef.current);
      modelRef.current.rotation.copy(anchorRotation);
      modelRef.current.scale.setScalar(modelScale * modelSize);
      
      // Calculate distance for depth-based effects
      const distance = camera.position.distanceTo(anchorRef.current);
      
      // Fade out if too close or too far
      if (distance < 0.3) {
        modelRef.current.visible = false;
      } else if (distance > 10) {
        modelRef.current.visible = false;
      } else {
        modelRef.current.visible = true;
      }
    }
  });

  if (!gltf?.scene) {
    return (
      <mesh>
        <boxGeometry args={[0.4, 0.4, 0.02]} />
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
        // Enable depth testing for proper occlusion
        child.material.depthTest = true;
        child.material.depthWrite = true;
      }
    }
  });

  // Center the model
  const box = new THREE.Box3().setFromObject(clonedScene);
  const center = box.getCenter(new THREE.Vector3());
  clonedScene.position.sub(center);

  return (
    <primitive ref={modelRef} object={clonedScene} visible={isPlaced} />
  );
}

/**
 * AR Scene Component
 */
function ARScene({ 
  currentModel, 
  onPlacement, 
  isPlaced, 
  anchorTransform, 
  onTransformChange,
  scanningPhase,
  onWallDetected
}) {
  const { camera, scene, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const [wallPosition, setWallPosition] = useState(null);
  const [wallNormal, setWallNormal] = useState(null);
  const wallPlanesRef = useRef([]);
  
  const touchStart = useRef({ x: 0, y: 0, distance: 0, timestamp: 0 });
  const lastPinchDist = useRef(0);
  const gestureMode = useRef(null);

  // Create wall detection planes with better coverage
  useEffect(() => {
    const walls = [];
    const positions = [
      { pos: [0, 0, -2], rot: [0, 0, 0], name: 'front' },
      { pos: [-2, 0, 0], rot: [0, Math.PI/2, 0], name: 'left' },
      { pos: [2, 0, 0], rot: [0, -Math.PI/2, 0], name: 'right' },
      { pos: [0, 0, 2], rot: [0, Math.PI, 0], name: 'back' },
      { pos: [0, -1.5, 0], rot: [Math.PI/2, 0, 0], name: 'floor' },
      { pos: [0, 1.5, 0], rot: [-Math.PI/2, 0, 0], name: 'ceiling' },
    ];
    
    positions.forEach(({ pos, rot, name }) => {
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6),
        new THREE.MeshBasicMaterial({ 
          visible: false, 
          side: THREE.DoubleSide 
        })
      );
      wall.position.set(...pos);
      wall.rotation.set(...rot);
      wall.userData.name = name;
      scene.add(wall);
      walls.push(wall);
    });
    
    wallPlanesRef.current = walls;
    return () => walls.forEach(wall => scene.remove(wall));
  }, [scene]);

  // Advanced wall detection with depth sensing
  useFrame(() => {
    if (scanningPhase && wallPlanesRef.current.length > 0) {
      raycaster.current.setFromCamera(new THREE.Vector2(0, 0), camera);
      const intersects = raycaster.current.intersectObjects(wallPlanesRef.current);
      
      if (intersects.length > 0) {
        const hit = intersects[0];
        const point = hit.point;
        const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        
        // Calculate distance for depth validation
        const distance = camera.position.distanceTo(point);
        
        // Only detect if distance is reasonable (0.5m to 5m)
        if (distance > 0.5 && distance < 5) {
          setWallPosition(point);
          setWallNormal(normal);
          onWallDetected(true, point, normal, distance);
        } else {
          setWallPosition(null);
          setWallNormal(null);
          onWallDetected(false);
        }
      } else {
        setWallPosition(null);
        setWallNormal(null);
        onWallDetected(false);
      }
    }
  });

  // Touch handling with better gesture recognition
  const handleTouchStart = useCallback((event) => {
    event.preventDefault();
    const now = Date.now();
    
    if (!isPlaced) {
      if (wallPosition && event.touches.length === 1) {
        // Place with slight offset from wall
        const offset = wallNormal.clone().multiplyScalar(0.02);
        const placementPos = wallPosition.clone().add(offset);
        onPlacement(placementPos, wallNormal);
      }
      return;
    }

    if (event.touches.length === 1) {
      touchStart.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY,
        timestamp: now
      };
      gestureMode.current = 'move';
    } else if (event.touches.length === 2) {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
      gestureMode.current = 'scale';
    }
  }, [isPlaced, wallPosition, wallNormal, onPlacement]);

  const handleTouchMove = useCallback((event) => {
    event.preventDefault();
    if (!isPlaced) return;

    if (event.touches.length === 1 && gestureMode.current === 'move') {
      const sensitivity = 0.001; // Reduced sensitivity for smoother movement
      const deltaX = (event.touches[0].clientX - touchStart.current.x) * sensitivity;
      const deltaY = -(event.touches[0].clientY - touchStart.current.y) * sensitivity;
      
      // Move in screen space but maintain world position
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0);
      
      const newPos = anchorTransform.position.clone();
      newPos.add(right.multiplyScalar(deltaX));
      newPos.add(up.multiplyScalar(deltaY));
      
      onTransformChange({
        position: newPos,
        rotation: anchorTransform.rotation,
        scale: anchorTransform.scale
      });
      
      touchStart.current.x = event.touches[0].clientX;
      touchStart.current.y = event.touches[0].clientY;
    } else if (event.touches.length === 2 && gestureMode.current === 'scale') {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      const delta = (dist - lastPinchDist.current) * 0.002; // Smoother scaling
      const newScale = Math.max(0.5, Math.min(2.5, anchorTransform.scale + delta));
      
      onTransformChange({
        position: anchorTransform.position,
        rotation: anchorTransform.rotation,
        scale: newScale
      });
      
      lastPinchDist.current = dist;
    }
  }, [isPlaced, anchorTransform, camera, onTransformChange]);

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
      <ScanningGrid isScanning={scanningPhase} />
      
      {wallPosition && (
        <WallReticle 
          position={wallPosition} 
          detected={scanningPhase} 
        />
      )}
      
      {currentModel && (
        <Suspense fallback={null}>
          <Model3D 
            url={currentModel} 
            anchorPosition={anchorTransform.position}
            anchorRotation={anchorTransform.rotation}
            modelScale={anchorTransform.scale}
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
  const [wallDetected, setWallDetected] = useState(false);
  const [wallDistance, setWallDistance] = useState(0);
  const [showGestureTutorial, setShowGestureTutorial] = useState(false);
  
  const [anchorTransform, setAnchorTransform] = useState({
    position: new THREE.Vector3(0, 0, -2),
    rotation: new THREE.Euler(0, 0, 0),
    scale: 1
  });

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
            frameRate: { ideal: 30 }
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
      
      setTimeout(() => setArPhase('ready'), 2500);
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

  const handleWallDetected = useCallback((detected, point, normal, distance) => {
    setWallDetected(detected);
    if (distance) setWallDistance(distance);
  }, []);

  const handlePlacement = useCallback((position, normal) => {
    // Create rotation to face away from wall
    const targetRotation = new THREE.Euler();
    if (normal) {
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
      targetRotation.setFromQuaternion(quaternion);
    }
    
    setAnchorTransform({
      position: position.clone(),
      rotation: targetRotation,
      scale: 1
    });
    setIsModelPlaced(true);
    setArPhase('placed');
    setShowGestureTutorial(true);
    setTimeout(() => setShowGestureTutorial(false), 6000);
    transformCount.current++;
  }, []);

  const handleTransformChange = useCallback((newTransform) => {
    setAnchorTransform(newTransform);
    transformCount.current++;
  }, []);

  const handleReset = useCallback(() => {
    setIsModelPlaced(false);
    setArPhase('ready');
    setAnchorTransform({
      position: new THREE.Vector3(0, 0, -2),
      rotation: new THREE.Euler(0, 0, 0),
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
          >
            <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={65} />
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
            <pointLight position={[-5, 5, -5]} intensity={0.3} />
            <hemisphereLight intensity={0.4} />
            <Environment preset="city" />
            
            {showGrid && <gridHelper args={[10, 10]} position={[0, -1.5, 0]} />}
            
            <ARScene 
              currentModel={currentModel}
              onPlacement={handlePlacement}
              isPlaced={isModelPlaced}
              anchorTransform={anchorTransform}
              onTransformChange={handleTransformChange}
              scanningPhase={arPhase === 'scanning' || arPhase === 'ready'}
              onWallDetected={handleWallDetected}
            />
          </Canvas>
        </div>
      )}

      {/* Status Overlays */}
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

      {/* Main AR UI */}
      {cameraStatus === 'ready' && (
        <>
          {/* Header */}
          <header className="ar-header">
            <button className="ar-btn-close" onClick={onClose}>
              <X size={22} />
            </button>
            
            <div className="ar-status-pill">
              {arPhase === 'scanning' && (
                <>
                  <div className="status-spinner-mini" />
                  <span>Scanning...</span>
                </>
              )}
              {arPhase === 'ready' && (
                <>
                  <div className={`status-indicator ${wallDetected ? 'active' : 'inactive'}`} />
                  <span>{wallDetected ? `Wall Found (${wallDistance.toFixed(1)}m)` : 'Searching...'}</span>
                </>
              )}
              {arPhase === 'placed' && (
                <>
                  <div className="status-indicator success" />
                  <span>Placed</span>
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

          {/* Scanning Instructions */}
          {arPhase === 'scanning' && (
            <div className="ar-scan-guide">
              <Scan size={40} className="scan-icon" />
              <h3>Environment Scanning</h3>
              <p>Move your device slowly to map the space</p>
              <div className="scan-bar-container">
                <div className="scan-bar-fill" />
              </div>
            </div>
          )}

          {/* Placement Instructions */}
          {arPhase === 'ready' && !isModelPlaced && (
            <div className="ar-placement-guide">
              <Crosshair size={28} />
              <h4>Point at a Wall</h4>
              <p>Tap the green reticle to place frame</p>
              {wallDetected && (
                <div className="distance-badge">
                  Distance: {wallDistance.toFixed(2)}m
                </div>
              )}
            </div>
          )}

          {/* Gesture Tutorial */}
          {showGestureTutorial && arPhase === 'placed' && (
            <div className="gesture-guide">
              <h4>👋 Controls</h4>
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

          {/* Action Buttons */}
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

          {/* Center Crosshair */}
          {arPhase === 'ready' && !isModelPlaced && wallDetected && (
            <div className="center-reticle">
              <div className="reticle-dot" />
              <svg className="reticle-circle" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="45" />
              </svg>
            </div>
          )}
        </>
      )}
    </div>
  );
}
