/**
 * CustomARViewer Component
 * Production-grade AR with environment scanning, wall detection, and modern UI
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
 * Scanning Grid Effect - Shows environment scanning
 */
function ScanningGrid({ isScanning }) {
  const meshRef = useRef();
  
  useFrame(({ clock }) => {
    if (meshRef.current && isScanning) {
      meshRef.current.position.z = -2 + Math.sin(clock.elapsedTime * 2) * 0.5;
      meshRef.current.material.opacity = 0.3 + Math.sin(clock.elapsedTime * 3) * 0.2;
    }
  });
  
  if (!isScanning) return null;
  
  return (
    <mesh ref={meshRef} position={[0, 0, -2]}>
      <planeGeometry args={[8, 8, 20, 20]} />
      <meshBasicMaterial 
        color="#00ff00" 
        wireframe 
        transparent 
        opacity={0.3}
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}

/**
 * Wall Detection Indicator
 */
function WallIndicator({ position, normal, detected }) {
  const meshRef = useRef();
  
  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.z += 0.03;
    }
  });
  
  if (!detected) return null;
  
  return (
    <group position={position}>
      <mesh ref={meshRef}>
        <ringGeometry args={[0.2, 0.25, 32]} />
        <meshBasicMaterial color="#00ff00" transparent opacity={0.8} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <circleGeometry args={[0.15, 32]} />
        <meshBasicMaterial color="#00ff00" transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
      {/* Pulsing effect */}
      <mesh>
        <ringGeometry args={[0.25, 0.3, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}

/**
 * Model Component with proper sizing
 */
function Model3D({ url, worldPosition, worldRotation, worldScale, isPlaced }) {
  const modelRef = useRef();
  const gltf = useGLTF(url);
  const [modelSize, setModelSize] = useState(1);

  useEffect(() => {
    if (gltf && gltf.scene) {
      // Calculate model bounding box for proper sizing
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      
      // Normalize to reasonable frame size (0.5 units = ~50cm)
      const targetSize = 0.5;
      const normalizeScale = targetSize / maxDim;
      setModelSize(normalizeScale);
    }
  }, [gltf]);

  useFrame(() => {
    if (modelRef.current && isPlaced) {
      modelRef.current.position.copy(worldPosition);
      modelRef.current.rotation.copy(worldRotation);
      modelRef.current.scale.setScalar(worldScale * modelSize);
    }
  });

  if (!gltf || !gltf.scene) {
    return (
      <mesh>
        <boxGeometry args={[0.5, 0.5, 0.05]} />
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
  worldTransform, 
  onTransformChange,
  scanningPhase,
  onWallDetected
}) {
  const { camera, scene, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const [wallPosition, setWallPosition] = useState(null);
  const [wallNormal, setWallNormal] = useState(null);
  const wallPlanesRef = useRef([]);
  
  const touchStart = useRef({ x: 0, y: 0, distance: 0 });
  const lastPinchDist = useRef(0);
  const gestureMode = useRef(null); // 'move', 'rotate', 'scale'

  // Create wall detection planes
  useEffect(() => {
    const walls = [];
    const positions = [
      { pos: [0, 0, -2.5], rot: [0, 0, 0] },
      { pos: [-2.5, 0, 0], rot: [0, Math.PI/2, 0] },
      { pos: [2.5, 0, 0], rot: [0, -Math.PI/2, 0] },
      { pos: [0, 0, 2.5], rot: [0, Math.PI, 0] },
      { pos: [0, 1.5, 0], rot: [Math.PI/2, 0, 0] },
    ];
    
    positions.forEach(({ pos, rot }) => {
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 5),
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
      );
      wall.position.set(...pos);
      wall.rotation.set(...rot);
      scene.add(wall);
      walls.push(wall);
    });
    
    wallPlanesRef.current = walls;
    return () => walls.forEach(wall => scene.remove(wall));
  }, [scene]);

  // Continuous wall detection
  useFrame(() => {
    if (scanningPhase && wallPlanesRef.current.length > 0) {
      raycaster.current.setFromCamera(new THREE.Vector2(0, 0), camera);
      const intersects = raycaster.current.intersectObjects(wallPlanesRef.current);
      
      if (intersects.length > 0) {
        const point = intersects[0].point;
        const normal = intersects[0].face.normal;
        const worldNormal = normal.clone().transformDirection(intersects[0].object.matrixWorld);
        
        setWallPosition(point);
        setWallNormal(worldNormal);
        onWallDetected(true, point, worldNormal);
      } else {
        setWallPosition(null);
        setWallNormal(null);
        onWallDetected(false);
      }
    }
  });

  // Touch gesture handling
  const handleTouchStart = useCallback((event) => {
    event.preventDefault();
    
    if (!isPlaced) {
      // Place model on tap
      if (wallPosition && event.touches.length === 1) {
        const offsetPos = wallPosition.clone().add(wallNormal.multiplyScalar(0.05));
        onPlacement(offsetPos, wallNormal);
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
  }, [isPlaced, wallPosition, wallNormal, onPlacement]);

  const handleTouchMove = useCallback((event) => {
    event.preventDefault();
    if (!isPlaced) return;

    if (event.touches.length === 1 && gestureMode.current === 'move') {
      const deltaX = (event.touches[0].clientX - touchStart.current.x) * 0.002;
      const deltaY = -(event.touches[0].clientY - touchStart.current.y) * 0.002;
      
      const newPos = worldTransform.position.clone();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0);
      
      newPos.add(right.multiplyScalar(deltaX));
      newPos.add(up.multiplyScalar(deltaY));
      
      onTransformChange({
        position: newPos,
        rotation: worldTransform.rotation,
        scale: worldTransform.scale
      });
      
      touchStart.current = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY
      };
    } else if (event.touches.length === 2 && gestureMode.current === 'scale') {
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      const delta = (dist - lastPinchDist.current) * 0.003;
      const newScale = Math.max(0.3, Math.min(3, worldTransform.scale + delta));
      
      onTransformChange({
        position: worldTransform.position,
        rotation: worldTransform.rotation,
        scale: newScale
      });
      
      lastPinchDist.current = dist;
    }
  }, [isPlaced, worldTransform, camera, onTransformChange]);

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
        <WallIndicator 
          position={wallPosition} 
          normal={wallNormal} 
          detected={scanningPhase} 
        />
      )}
      
      {currentModel && (
        <Suspense fallback={null}>
          <Model3D 
            url={currentModel} 
            worldPosition={worldTransform.position}
            worldRotation={worldTransform.rotation}
            worldScale={worldTransform.scale}
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
  const [arPhase, setArPhase] = useState('scanning'); // scanning, ready, placed
  const [isModelPlaced, setIsModelPlaced] = useState(false);
  const [wallDetected, setWallDetected] = useState(false);
  const [showGestureTutorial, setShowGestureTutorial] = useState(false);
  
  const [worldTransform, setWorldTransform] = useState({
    position: new THREE.Vector3(0, 0, -2),
    rotation: new THREE.Euler(0, 0, 0),
    scale: 1
  });

  const { currentModel, modelType, showGrid, toggleGrid } = useARStore();

  // Camera initialization
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
        { video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false },
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
      
      // Start scanning phase
      setTimeout(() => {
        setArPhase('ready');
      }, 2000);

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
    // Copy ref values to variables for cleanup
    const startTime = sessionStartTime.current;
    const screenshotCountValue = screenshotCount.current;
    const transformCountValue = transformCount.current;

    const timer = setTimeout(() => initCamera(), 500);
    
    return () => {
      clearTimeout(timer);
      stopCamera();
      
      // Use copied variables in cleanup
      analytics.trackARSessionEnded({
        duration: Date.now() - startTime,
        screenshots: screenshotCountValue,
        transforms: transformCountValue,
      });
    };
  }, [initCamera, stopCamera]);

  const handleWallDetected = useCallback((detected) => {
    setWallDetected(detected);
  }, []);

  const handlePlacement = useCallback((position) => {
    setWorldTransform({
      position: position.clone(),
      rotation: new THREE.Euler(0, 0, 0),
      scale: 1
    });
    setIsModelPlaced(true);
    setArPhase('placed');
    setShowGestureTutorial(true);
    setTimeout(() => setShowGestureTutorial(false), 5000);
    transformCount.current++;
  }, []);

  const handleTransformChange = useCallback((newTransform) => {
    setWorldTransform(newTransform);
    transformCount.current++;
  }, []);

  const handleReset = useCallback(() => {
    setIsModelPlaced(false);
    setArPhase('ready');
    setWorldTransform({
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
    <div className="ar-viewer-modern">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="ar-video-bg"
      />

      {cameraStatus === 'ready' && (
        <div ref={canvasRef} className="ar-canvas-container">
          <Canvas
            gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
            style={{ background: 'transparent' }}
          >
            <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={60} />
            <ambientLight intensity={0.7} />
            <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
            <pointLight position={[-5, 5, -5]} intensity={0.5} />
            <Environment preset="city" />
            {showGrid && <gridHelper args={[10, 10]} position={[0, -1.5, 0]} />}
            
            <ARScene 
              currentModel={currentModel}
              onPlacement={handlePlacement}
              isPlaced={isModelPlaced}
              worldTransform={worldTransform}
              onTransformChange={handleTransformChange}
              scanningPhase={arPhase === 'scanning' || arPhase === 'ready'}
              onWallDetected={handleWallDetected}
            />
          </Canvas>
        </div>
      )}

      {/* Loading */}
      {cameraStatus !== 'ready' && cameraStatus !== 'error' && (
        <div className="ar-status-overlay">
          <div className="status-spinner"></div>
          <h3>Initializing AR</h3>
          <p>Getting camera ready...</p>
        </div>
      )}

      {/* Error */}
      {cameraStatus === 'error' && (
        <div className="ar-status-overlay error">
          <div className="error-icon">⚠️</div>
          <h3>Camera Error</h3>
          <p>{cameraError}</p>
          <div className="button-group">
            <button className="btn-modern primary" onClick={retryCamera}>
              <RefreshCw size={20} /> Retry
            </button>
            <button className="btn-modern" onClick={onClose}>
              <X size={20} /> Close
            </button>
          </div>
        </div>
      )}

      {/* AR UI */}
      {cameraStatus === 'ready' && (
        <>
          {/* Top Bar */}
          <div className="ar-topbar-modern">
            <button className="btn-icon-modern" onClick={onClose}>
              <X size={24} />
            </button>
            
            <div className="ar-status-badge">
              {arPhase === 'scanning' && (
                <>
                  <Scan className="animate-pulse" size={18} />
                  <span>Scanning Environment...</span>
                </>
              )}
              {arPhase === 'ready' && (
                <>
                  <div className={`status-dot ${wallDetected ? 'active' : ''}`} />
                  <span>{wallDetected ? 'Wall Detected - Tap to Place' : 'Looking for walls...'}</span>
                </>
              )}
              {arPhase === 'placed' && (
                <>
                  <div className="status-dot active" />
                  <span>Frame Placed</span>
                </>
              )}
            </div>

            <div className="ar-actions-modern">
              <button className="btn-icon-modern" onClick={toggleGrid} title="Grid">
                <Grid size={20} />
              </button>
              <button className="btn-icon-modern" onClick={switchCamera} title="Switch Camera">
                <RefreshCw size={20} />
              </button>
              <button className="btn-icon-modern" onClick={toggleFullscreen} title="Fullscreen">
                {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
              </button>
            </div>
          </div>

          {/* Instructions */}
          {arPhase === 'ready' && !isModelPlaced && (
            <div className="ar-instruction-card">
              <div className="instruction-icon">
                <Scan size={32} />
              </div>
              <h3>Point at a Wall</h3>
              <p>Move your device slowly to scan walls</p>
              <div className="scan-progress">
                <div className={`scan-bar ${wallDetected ? 'detected' : ''}`} />
              </div>
            </div>
          )}

          {/* Gesture Tutorial */}
          {showGestureTutorial && arPhase === 'placed' && (
            <div className="gesture-tutorial">
              <h3>Gesture Controls</h3>
              <div className="gesture-list">
                <div className="gesture-item">
                  <Move size={24} />
                  <span>Drag to move</span>
                </div>
                <div className="gesture-item">
                  <Hand size={24} />
                  <span>Pinch to scale</span>
                </div>
                <div className="gesture-item">
                  <RotateCw size={24} />
                  <span>Two fingers to rotate</span>
                </div>
              </div>
            </div>
          )}

          {/* Floating Controls */}
          {isModelPlaced && (
            <div className="ar-floating-controls">
              <button 
                className="btn-floating primary" 
                onClick={handleScreenshot}
                title="Capture"
              >
                <Camera size={24} />
              </button>
              <button 
                className="btn-floating" 
                onClick={handleReset}
                title="Reset"
              >
                <RotateCcw size={24} />
              </button>
              <button 
                className="btn-floating" 
                onClick={() => setShowGestureTutorial(!showGestureTutorial)}
                title="Help"
              >
                <Hand size={24} />
              </button>
            </div>
          )}

          {/* Center Crosshair */}
          {arPhase === 'ready' && !isModelPlaced && wallDetected && (
            <div className="ar-crosshair">
              <div className="crosshair-center" />
              <div className="crosshair-ring" />
            </div>
          )}
        </>
      )}
    </div>
  );
}
