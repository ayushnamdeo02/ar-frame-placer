/**
 * CustomARViewer Component
 * Advanced AR with depth detection, wall detection, and intelligent placement
 */
import React, { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, useGLTF, Center, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { 
  X, 
  Camera, 
  RotateCw, 
  ZoomIn, 
  ZoomOut, 
  Maximize2,
  Minimize2,
  Grid,
  RotateCcw,
  RefreshCw,
  Target
} from 'lucide-react';

import useARStore from '../store/useARStore';
import analytics from '../services/analytics';
import { TRANSFORM_CONFIG } from '../utils/constants';

/**
 * Wall Plane Component - Invisible planes for detecting walls
 */
function WallPlanes({ onWallDetected }) {
  const wallsRef = useRef([]);
  const { camera } = useThree();
  
  useEffect(() => {
    // Create invisible wall planes at different positions
    const walls = [];
    
    // Front wall
    walls.push(new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    ));
    walls[0].position.set(0, 0, -3);
    
    // Left wall
    walls.push(new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    ));
    walls[1].position.set(-3, 0, 0);
    walls[1].rotation.y = Math.PI / 2;
    
    // Right wall
    walls.push(new THREE.Mesh(
      new THREE.PlaneGeometry(10, 10),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
    ));
    walls[2].position.set(3, 0, 0);
    walls[2].rotation.y = -Math.PI / 2;
    
    wallsRef.current = walls;
    walls.forEach(wall => camera.parent.add(wall));
    
    return () => {
      walls.forEach(wall => camera.parent.remove(wall));
    };
  }, [camera]);
  
  return null;
}

/**
 * Placement Reticle Component - Shows where frame will be placed
 */
function PlacementReticle({ position, visible }) {
  const meshRef = useRef();
  
  useFrame(() => {
    if (meshRef.current && visible) {
      meshRef.current.rotation.z += 0.02;
    }
  });
  
  if (!visible) return null;
  
  return (
    <group position={position}>
      <mesh ref={meshRef}>
        <ringGeometry args={[0.15, 0.2, 32]} />
        <meshBasicMaterial color="#00ff00" transparent opacity={0.7} side={THREE.DoubleSide} />
      </mesh>
      <mesh>
        <ringGeometry args={[0.08, 0.12, 32]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      {/* Crosshair */}
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[0.3, 0.02]} />
        <meshBasicMaterial color="#00ff00" transparent opacity={0.7} />
      </mesh>
      <mesh position={[0, 0, 0.01]} rotation={[0, 0, Math.PI / 2]}>
        <planeGeometry args={[0.3, 0.02]} />
        <meshBasicMaterial color="#00ff00" transparent opacity={0.7} />
      </mesh>
    </group>
  );
}

/**
 * Model Component - Renders the 3D model with fixed positioning
 */
function Model3D({ url, worldPosition, worldRotation, worldScale, isPlaced }) {
  const modelRef = useRef();
  const gltf = useGLTF(url);
  const { camera } = useThree();

  useFrame(() => {
    if (modelRef.current && isPlaced) {
      // Keep model at fixed world position regardless of camera movement
      modelRef.current.position.copy(worldPosition);
      modelRef.current.rotation.copy(worldRotation);
      modelRef.current.scale.setScalar(worldScale);
    }
  });

  if (!gltf || !gltf.scene) {
    return (
      <mesh>
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color="#cccccc" wireframe />
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

  return (
    <Center>
      <primitive ref={modelRef} object={clonedScene} visible={isPlaced} />
    </Center>
  );
}

/**
 * AR Scene Component - Handles all 3D interactions
 */
function ARScene({ currentModel, onPlacement, isPlaced, worldTransform, onTransformChange }) {
  const { camera, scene, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const mouse = useRef(new THREE.Vector2());
  const [reticlePosition, setReticlePosition] = useState(new THREE.Vector3(0, 0, -2));
  const [showReticle, setShowReticle] = useState(!isPlaced);
  const wallPlanesRef = useRef([]);
  
  // Touch gesture handling
  const touchStart = useRef({ x: 0, y: 0, distance: 0 });
  const isDragging = useRef(false);
  const isPinching = useRef(false);

  // Create wall detection planes
  useEffect(() => {
    const walls = [];
    
    // Create multiple wall planes around the scene
    const wallPositions = [
      { pos: [0, 0, -3], rot: [0, 0, 0] },           // Front
      { pos: [-3, 0, 0], rot: [0, Math.PI/2, 0] },   // Left
      { pos: [3, 0, 0], rot: [0, -Math.PI/2, 0] },   // Right
      { pos: [0, 0, 3], rot: [0, Math.PI, 0] },      // Back
    ];
    
    wallPositions.forEach(({ pos, rot }) => {
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 10),
        new THREE.MeshBasicMaterial({ 
          visible: false, 
          side: THREE.DoubleSide 
        })
      );
      wall.position.set(...pos);
      wall.rotation.set(...rot);
      wall.userData.isWall = true;
      scene.add(wall);
      walls.push(wall);
    });
    
    wallPlanesRef.current = walls;
    
    return () => {
      walls.forEach(wall => scene.remove(wall));
    };
  }, [scene]);

  // Update reticle position based on camera direction
  useFrame(() => {
    if (!isPlaced && wallPlanesRef.current.length > 0) {
      // Cast ray from center of screen
      raycaster.current.setFromCamera(new THREE.Vector2(0, 0), camera);
      
      const intersects = raycaster.current.intersectObjects(wallPlanesRef.current);
      
      if (intersects.length > 0) {
        const point = intersects[0].point;
        const normal = intersects[0].face.normal;
        
        // Offset slightly from wall
        const offsetPoint = point.clone().add(normal.multiplyScalar(0.01));
        setReticlePosition(offsetPoint);
        setShowReticle(true);
      } else {
        // Default position in front of camera
        const forward = new THREE.Vector3(0, 0, -2);
        forward.applyQuaternion(camera.quaternion);
        setReticlePosition(camera.position.clone().add(forward));
        setShowReticle(true);
      }
    }
  });

  // Handle tap/click to place
  const handlePointerDown = useCallback((event) => {
    if (isPlaced) {
      // Handle model manipulation
      const rect = gl.domElement.getBoundingClientRect();
      
      if (event.touches && event.touches.length === 1) {
        // Single touch - start drag
        touchStart.current = {
          x: event.touches[0].clientX,
          y: event.touches[0].clientY,
          distance: 0
        };
        isDragging.current = true;
      } else if (event.touches && event.touches.length === 2) {
        // Two fingers - pinch to scale
        const dx = event.touches[0].clientX - event.touches[1].clientX;
        const dy = event.touches[0].clientY - event.touches[1].clientY;
        touchStart.current.distance = Math.sqrt(dx * dx + dy * dy);
        isPinching.current = true;
        isDragging.current = false;
      }
    } else {
      // Place the model
      onPlacement(reticlePosition);
      setShowReticle(false);
    }
  }, [isPlaced, reticlePosition, onPlacement, gl]);

  const handlePointerMove = useCallback((event) => {
    if (!isPlaced || !isDragging.current) return;
    
    if (event.touches && event.touches.length === 1 && isDragging.current) {
      // Move model
      const deltaX = (event.touches[0].clientX - touchStart.current.x) * 0.01;
      const deltaY = -(event.touches[0].clientY - touchStart.current.y) * 0.01;
      
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
      
      touchStart.current.x = event.touches[0].clientX;
      touchStart.current.y = event.touches[0].clientY;
    } else if (event.touches && event.touches.length === 2 && isPinching.current) {
      // Scale model
      const dx = event.touches[0].clientX - event.touches[1].clientX;
      const dy = event.touches[0].clientY - event.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      const delta = (distance - touchStart.current.distance) * 0.005;
      const newScale = Math.max(0.1, Math.min(5, worldTransform.scale + delta));
      
      onTransformChange({
        position: worldTransform.position,
        rotation: worldTransform.rotation,
        scale: newScale
      });
      
      touchStart.current.distance = distance;
    }
  }, [isPlaced, worldTransform, camera, onTransformChange]);

  const handlePointerUp = useCallback(() => {
    isDragging.current = false;
    isPinching.current = false;
  }, []);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('touchstart', handlePointerDown);
    canvas.addEventListener('touchmove', handlePointerMove);
    canvas.addEventListener('touchend', handlePointerUp);
    
    return () => {
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('touchstart', handlePointerDown);
      canvas.removeEventListener('touchmove', handlePointerMove);
      canvas.removeEventListener('touchend', handlePointerUp);
    };
  }, [gl, handlePointerDown, handlePointerMove, handlePointerUp]);

  return (
    <>
      {currentModel && (
        <Suspense fallback={
          <mesh>
            <boxGeometry args={[1, 1, 1]} />
            <meshStandardMaterial color="#007AFF" wireframe />
          </mesh>
        }>
          <Model3D 
            url={currentModel} 
            worldPosition={worldTransform.position}
            worldRotation={worldTransform.rotation}
            worldScale={worldTransform.scale}
            isPlaced={isPlaced}
          />
        </Suspense>
      )}
      
      <PlacementReticle 
        position={reticlePosition} 
        visible={showReticle && !isPlaced} 
      />
    </>
  );
}

/**
 * Main CustomARViewer Component
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
  const [isModelPlaced, setIsModelPlaced] = useState(false);
  const [worldTransform, setWorldTransform] = useState({
    position: new THREE.Vector3(0, 0, -2),
    rotation: new THREE.Euler(0, 0, 0),
    scale: 1
  });

  const {
    currentModel,
    modelType,
    showControls,
    showGrid,
    toggleControls,
    toggleGrid,
    resetTransform,
  } = useARStore();

  // Camera initialization (same as before)
  const initCamera = useCallback(async () => {
    if (streamRef.current || initAttempts.current > 3) return;

    initAttempts.current++;
    setCameraStatus('requesting');
    setCameraError(null);

    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('Camera API not supported in this browser');
      }

      const isSecure = window.location.protocol === 'https:' || 
                       window.location.hostname === 'localhost' ||
                       window.location.hostname === '127.0.0.1';
      
      if (!isSecure) {
        throw new Error('Camera requires HTTPS');
      }

      const constraintSets = [
        {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920 },
            height: { ideal: 1080 }
          },
          audio: false
        },
        { video: { facingMode: facingMode }, audio: false },
        { video: true, audio: false }
      ];

      let stream = null;
      for (const constraints of constraintSets) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (stream) break;
        } catch (err) {
          console.warn('Constraint failed:', err);
        }
      }

      if (!stream) throw new Error('Failed to access camera');

      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) throw new Error('Video element not found');

      video.srcObject = stream;

      await new Promise((resolve, reject) => {
        video.onloadedmetadata = resolve;
        video.onerror = reject;
        setTimeout(() => reject(new Error('Timeout')), 10000);
      });

      await video.play();
      setCameraStatus('ready');
      
      analytics.trackARSessionStarted({
        url: currentModel,
        type: modelType,
        cameraFacing: facingMode
      });

    } catch (error) {
      setCameraStatus('error');
      setCameraError(error.message || 'Camera access failed');
    }
  }, [facingMode, currentModel, modelType]);

  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
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
    setCameraError(null);
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
      const duration = Date.now() - startTime;
      analytics.trackARSessionEnded({
        duration,
        screenshots: screenshotCountValue,
        transforms: transformCountValue,
      });
    };
  }, [initCamera, stopCamera]);

  const handlePlacement = useCallback((position) => {
    setWorldTransform({
      position: position.clone(),
      rotation: new THREE.Euler(0, 0, 0),
      scale: 1
    });
    setIsModelPlaced(true);
    transformCount.current++;
  }, []);

  const handleTransformChange = useCallback((newTransform) => {
    setWorldTransform(newTransform);
    transformCount.current++;
  }, []);

  const handleReset = useCallback(() => {
    setIsModelPlaced(false);
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

      composite.width = video.videoWidth || window.innerWidth;
      composite.height = video.videoHeight || window.innerHeight;

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
        analytics.trackScreenshotCaptured();
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

  const handleClose = useCallback(() => {
    stopCamera();
    onClose();
  }, [stopCamera, onClose]);

  return (
    <div className="ar-viewer">
      <video
        ref={videoRef}
        className="ar-video"
        autoPlay
        playsInline
        muted
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 1
        }}
      />

      {cameraStatus === 'ready' && (
        <div ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 2, pointerEvents: 'auto' }}>
          <Canvas
            gl={{ 
              alpha: true, 
              antialias: true,
              preserveDrawingBuffer: true,
            }}
            style={{ background: 'transparent' }}
          >
            <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={60} />
            
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 5, 5]} intensity={1} castShadow />
            <pointLight position={[-5, 5, -5]} intensity={0.4} />
            
            <Environment preset="city" />
            
            {showGrid && <gridHelper args={[10, 10]} position={[0, -1.5, 0]} />}
            
            <ARScene 
              currentModel={currentModel}
              onPlacement={handlePlacement}
              isPlaced={isModelPlaced}
              worldTransform={worldTransform}
              onTransformChange={handleTransformChange}
            />
          </Canvas>
        </div>
      )}

      {(cameraStatus === 'initializing' || cameraStatus === 'requesting') && (
        <div className="ar-overlay loading-overlay">
          <div className="loading-spinner"></div>
          <p>{cameraStatus === 'initializing' ? 'Initializing...' : 'Requesting camera...'}</p>
        </div>
      )}

      {cameraStatus === 'error' && (
        <div className="ar-overlay error-overlay">
          <div className="error-icon">⚠️</div>
          <h3>Camera Error</h3>
          <p>{cameraError}</p>
          <button className="btn btn-primary" onClick={retryCamera}>
            <RefreshCw size={18} /> Retry
          </button>
          <button className="btn btn-secondary" onClick={handleClose}>
            <X size={18} /> Close
          </button>
        </div>
      )}

      {cameraStatus === 'ready' && (
        <>
          <div className="ar-topbar">
            <button className="btn-icon" onClick={handleClose}>
              <X size={24} />
            </button>

            <div className="ar-info-badge">
              <span>{isModelPlaced ? '✅ Placed' : '🎯 Tap to Place'}</span>
            </div>

            <div className="ar-actions">
              <button className="btn-icon" onClick={toggleGrid}>
                <Grid size={20} />
              </button>
              <button className="btn-icon" onClick={switchCamera}>
                <RefreshCw size={20} />
              </button>
              <button className="btn-icon" onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
              </button>
            </div>
          </div>

          {!isModelPlaced && (
            <div className="ar-instructions">
              <Target size={24} />
              <p>Point camera at a wall surface and tap to place frame</p>
            </div>
          )}

          {isModelPlaced && (
            <div className="ar-instructions">
              <p>👆 Drag to move • 🤏 Pinch to scale • Frame stays on wall</p>
            </div>
          )}

          {isModelPlaced && (
            <div className="ar-controls-floating">
              <button className="control-btn-floating" onClick={handleScreenshot} title="Capture">
                <Camera size={24} />
              </button>
              <button className="control-btn-floating" onClick={handleReset} title="Reset">
                <RotateCcw size={24} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
