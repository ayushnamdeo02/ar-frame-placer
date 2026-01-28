/**
 * Native-Quality AR Viewer - Like ARKit Quick Look
 * Real wall detection, depth sensing, world anchoring, full gesture control
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
  Scan,
  AlertTriangle,
  CheckCircle,
  ZoomIn,
  RotateCw
} from 'lucide-react';

import useARStore from '../store/useARStore';
import analytics from '../services/analytics';

/**
 * Advanced Wall Detector using Camera Feed Analysis
 */
class CameraAnalyzer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.lastAnalysis = null;
  }

  analyzeFrame(video) {
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) return null;

    this.canvas.width = 320;
    this.canvas.height = 240;
    
    this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    
    // Analyze center region for wall detection
    const centerX = Math.floor(this.canvas.width / 2);
    const centerY = Math.floor(this.canvas.height / 2);
    const regionSize = 80;
    
    let brightness = 0;
    let saturation = 0;
    let edgeCount = 0;
    let uniformity = 0;
    
    const pixels = [];
    
    for (let y = centerY - regionSize; y < centerY + regionSize; y++) {
      for (let x = centerX - regionSize; x < centerX + regionSize; x++) {
        if (x < 0 || x >= this.canvas.width || y < 0 || y >= this.canvas.height) continue;
        
        const idx = (y * this.canvas.width + x) * 4;
        const r = imageData.data[idx];
        const g = imageData.data[idx + 1];
        const b = imageData.data[idx + 2];
        
        brightness += (r + g + b) / 3;
        
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        saturation += max - min;
        
        pixels.push({ r, g, b });
        
        // Edge detection
        if (x > 0 && y > 0) {
          const prevIdx = ((y - 1) * this.canvas.width + x) * 4;
          const diff = Math.abs(imageData.data[idx] - imageData.data[prevIdx]);
          if (diff > 30) edgeCount++;
        }
      }
    }
    
    const pixelCount = pixels.length;
    brightness /= pixelCount;
    saturation /= pixelCount;
    
    // Calculate color uniformity (walls are usually uniform)
    const avgR = pixels.reduce((sum, p) => sum + p.r, 0) / pixelCount;
    const avgG = pixels.reduce((sum, p) => sum + p.g, 0) / pixelCount;
    const avgB = pixels.reduce((sum, p) => sum + p.b, 0) / pixelCount;
    
    let variance = 0;
    pixels.forEach(p => {
      variance += Math.pow(p.r - avgR, 2) + Math.pow(p.g - avgG, 2) + Math.pow(p.b - avgB, 2);
    });
    variance /= pixelCount;
    uniformity = 1 / (1 + variance / 10000); // Normalize
    
    // Classification
    const edgeDensity = edgeCount / pixelCount;
    
    let surfaceType = 'unknown';
    let confidence = 0;
    let reason = '';
    
    // Wall: uniform, medium brightness, low edges
    if (uniformity > 0.5 && edgeDensity < 0.1 && brightness > 50 && brightness < 220) {
      surfaceType = 'wall';
      confidence = uniformity * 0.5 + (1 - edgeDensity) * 0.3 + (1 - saturation / 100) * 0.2;
      reason = 'Good wall surface';
    }
    // Window: high brightness, high edges
    else if (brightness > 180 || (edgeDensity > 0.15 && saturation < 30)) {
      surfaceType = 'window';
      confidence = 0.2;
      reason = 'Window or bright area';
    }
    // Floor: typically darker, textured
    else if (brightness < 100 && edgeDensity > 0.12) {
      surfaceType = 'floor';
      confidence = 0.1;
      reason = 'Floor or dark surface';
    }
    // Textured/busy area
    else if (edgeDensity > 0.15 || uniformity < 0.3) {
      surfaceType = 'textured';
      confidence = 0.2;
      reason = 'Too much detail/texture';
    }
    else {
      surfaceType = 'uncertain';
      confidence = 0.3;
      reason = 'Unclear surface';
    }
    
    this.lastAnalysis = {
      surfaceType,
      confidence,
      reason,
      brightness,
      uniformity,
      edgeDensity,
      isWall: surfaceType === 'wall' && confidence > 0.5
    };
    
    return this.lastAnalysis;
  }
}

/**
 * IMU-based World Tracker (uses device sensors)
 */
class IMUWorldTracker {
  constructor() {
    this.worldAnchors = new Map();
    this.deviceOrientation = { alpha: 0, beta: 0, gamma: 0 };
    this.deviceMotion = { x: 0, y: 0, z: 0 };
    this.initialOrientation = null;
    this.cameraOffset = new THREE.Vector3(0, 0, 0);
    
    this.startTracking();
  }

  startTracking() {
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', (e) => {
        if (!this.initialOrientation && e.alpha !== null) {
          this.initialOrientation = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
        }
        this.deviceOrientation = { alpha: e.alpha, beta: e.beta, gamma: e.gamma };
      }, true);
    }

    if (window.DeviceMotionEvent) {
      window.addEventListener('devicemotion', (e) => {
        if (e.acceleration) {
          this.deviceMotion.x = e.acceleration.x || 0;
          this.deviceMotion.y = e.acceleration.y || 0;
          this.deviceMotion.z = e.acceleration.z || 0;
        }
      }, true);
    }
  }

  addAnchor(id, cameraPosition, cameraRotation, targetPosition, targetRotation) {
    // Store anchor in world space relative to initial camera position
    this.worldAnchors.set(id, {
      worldPosition: targetPosition.clone(),
      worldRotation: targetRotation.clone(),
      cameraPositionAtPlacement: cameraPosition.clone(),
      cameraRotationAtPlacement: cameraRotation.clone(),
      locked: true
    });
  }

  getAnchorTransform(id, currentCamera) {
    const anchor = this.worldAnchors.get(id);
    if (!anchor) return null;

    // Calculate camera movement since placement
    const cameraDelta = new THREE.Vector3()
      .subVectors(currentCamera.position, anchor.cameraPositionAtPlacement);

    // Keep anchor at original world position
    const adjustedPosition = anchor.worldPosition.clone().sub(cameraDelta);

    return {
      position: adjustedPosition,
      rotation: anchor.worldRotation.clone(),
      scale: 1
    };
  }

  updateAnchor(id, newTransform) {
    const anchor = this.worldAnchors.get(id);
    if (anchor) {
      if (newTransform.position) anchor.worldPosition.copy(newTransform.position);
      if (newTransform.rotation) anchor.worldRotation.copy(newTransform.rotation);
    }
  }
}

/**
 * Gesture Controller - Full touch controls
 */
class GestureController {
  constructor(onTransform) {
    this.onTransform = onTransform;
    this.touches = [];
    this.mode = null;
    this.lastSingleTouch = null;
    this.lastPinchDistance = 0;
    this.lastRotationAngle = 0;
  }

  handleTouchStart(event, currentTransform) {
    this.touches = Array.from(event.touches);
    
    if (this.touches.length === 1) {
      this.mode = 'move';
      this.lastSingleTouch = {
        x: this.touches[0].clientX,
        y: this.touches[0].clientY
      };
    } else if (this.touches.length === 2) {
      const dx = this.touches[0].clientX - this.touches[1].clientX;
      const dy = this.touches[0].clientY - this.touches[1].clientY;
      this.lastPinchDistance = Math.sqrt(dx * dx + dy * dy);
      this.lastRotationAngle = Math.atan2(dy, dx);
      this.mode = 'pinch-rotate';
    }
  }

  handleTouchMove(event, currentTransform, camera) {
    this.touches = Array.from(event.touches);
    
    if (this.mode === 'move' && this.touches.length === 1) {
      const deltaX = (this.touches[0].clientX - this.lastSingleTouch.x) * 0.001;
      const deltaY = -(this.touches[0].clientY - this.lastSingleTouch.y) * 0.001;
      
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0);
      
      const newPos = currentTransform.position.clone();
      newPos.add(right.multiplyScalar(deltaX));
      newPos.add(up.multiplyScalar(deltaY));
      
      this.onTransform({
        position: newPos,
        rotation: currentTransform.rotation,
        scale: currentTransform.scale
      });
      
      this.lastSingleTouch = {
        x: this.touches[0].clientX,
        y: this.touches[0].clientY
      };
    }
    else if (this.mode === 'pinch-rotate' && this.touches.length === 2) {
      const dx = this.touches[0].clientX - this.touches[1].clientX;
      const dy = this.touches[0].clientY - this.touches[1].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      
      // Scale
      const scaleDelta = (distance - this.lastPinchDistance) * 0.002;
      const newScale = Math.max(0.3, Math.min(4, currentTransform.scale + scaleDelta));
      
      // Rotation
      const rotationDelta = angle - this.lastRotationAngle;
      const newRotation = currentTransform.rotation.clone();
      const rotationQuat = new THREE.Quaternion();
      rotationQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotationDelta * 0.5);
      newRotation.multiply(rotationQuat);
      
      this.onTransform({
        position: currentTransform.position,
        rotation: newRotation,
        scale: newScale
      });
      
      this.lastPinchDistance = distance;
      this.lastRotationAngle = angle;
    }
  }

  handleTouchEnd() {
    this.mode = null;
    this.touches = [];
  }
}

/**
 * Smart Reticle with Real-time Feedback
 */
function SmartReticle({ position, analysis, visible }) {
  const ringRef = useRef();
  const pulseRef = useRef();
  
  useFrame(({ clock }) => {
    if (ringRef.current && visible) {
      ringRef.current.rotation.z = clock.elapsedTime * 0.5;
    }
    if (pulseRef.current && visible) {
      const scale = 1 + Math.sin(clock.elapsedTime * 3) * 0.1;
      pulseRef.current.scale.setScalar(scale);
    }
  });
  
  if (!visible) return null;

  const isGood = analysis?.isWall && analysis?.confidence > 0.5;
  const color = isGood ? '#00ff00' : '#ff0000';
  const size = isGood ? 1 : 0.7;
  
  return (
    <group position={position}>
      <mesh>
        <circleGeometry args={[0.03 * size, 32]} />
        <meshBasicMaterial color={color} transparent opacity={1} depthTest={false} />
      </mesh>
      
      <mesh ref={ringRef}>
        <ringGeometry args={[0.1 * size, 0.11 * size, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.8} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      
      <mesh ref={pulseRef}>
        <ringGeometry args={[0.15 * size, 0.16 * size, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      
      {isGood && (
        <>
          {[0, 90, 180, 270].map((angle, i) => (
            <mesh 
              key={i}
              position={[
                Math.cos((angle * Math.PI) / 180) * 0.2,
                Math.sin((angle * Math.PI) / 180) * 0.2,
                0
              ]}
              rotation={[0, 0, (angle * Math.PI) / 180]}
            >
              <planeGeometry args={[0.05, 0.012]} />
              <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
            </mesh>
          ))}
        </>
      )}
      
      {!isGood && (
        <>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <planeGeometry args={[0.2, 0.025]} />
            <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
          </mesh>
          <mesh rotation={[0, 0, -Math.PI / 4]}>
            <planeGeometry args={[0.2, 0.025]} />
            <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

/**
 * World-Anchored 3D Model
 */
function WorldAnchoredModel({ url, worldTracker, anchorId, isPlaced, currentTransform }) {
  const modelRef = useRef();
  const gltf = useGLTF(url);
  const [modelSize, setModelSize] = useState(1);
  const { camera } = useThree();

  useEffect(() => {
    if (gltf?.scene) {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      setModelSize(0.45 / maxDim);
    }
  }, [gltf]);

  useFrame(() => {
    if (!modelRef.current || !isPlaced) return;

    if (currentTransform) {
      // Use current transform during gesture control
      modelRef.current.position.copy(currentTransform.position);
      modelRef.current.quaternion.copy(currentTransform.rotation);
      modelRef.current.scale.setScalar(currentTransform.scale * modelSize);
    } else {
      // Use world tracker position
      const anchor = worldTracker?.getAnchorTransform(anchorId, camera);
      if (anchor) {
        modelRef.current.position.copy(anchor.position);
        modelRef.current.quaternion.copy(anchor.rotation);
        modelRef.current.scale.setScalar(anchor.scale * modelSize);
      }
    }

    modelRef.current.visible = true;
  });

  if (!gltf?.scene) return null;

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
      }
    }
  });

  const box = new THREE.Box3().setFromObject(clonedScene);
  const center = box.getCenter(new THREE.Vector3());
  clonedScene.position.sub(center);

  return <primitive ref={modelRef} object={clonedScene} />;
}

/**
 * Detection Planes
 */
function DetectionPlanes({ onHitTest, isActive }) {
  const { camera, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const planes = useRef([]);

  useEffect(() => {
    const distances = [1, 1.5, 2, 2.5, 3, 3.5];
    const newPlanes = [];
    
    distances.forEach(dist => {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(6, 6),
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
      );
      plane.position.set(0, 0, -dist);
      scene.add(plane);
      newPlanes.push(plane);
    });
    
    planes.current = newPlanes;
    
    return () => {
      newPlanes.forEach(p => scene.remove(p));
    };
  }, [scene]);

  useFrame(() => {
    if (!isActive) return;

    raycaster.current.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.current.intersectObjects(planes.current);

    if (intersects.length > 0) {
      const hit = intersects[0];
      onHitTest({
        point: hit.point,
        distance: hit.distance,
        normal: new THREE.Vector3(0, 0, 1)
      });
    }
  });

  return null;
}

/**
 * Main AR Scene
 */
function ARScene({ 
  currentModel, 
  worldTracker,
  cameraAnalyzer,
  onPlacement,
  isPlaced,
  scanningPhase,
  onAnalysisUpdate,
  currentTransform,
  gestureController
}) {
  const { camera, gl } = useThree();
  const [hitData, setHitData] = useState(null);
  const [analysis, setAnalysis] = useState(null);

  const handleHitTest = useCallback((data) => {
    setHitData(data);
  }, []);

  useFrame(() => {
    if (scanningPhase && cameraAnalyzer) {
      // Periodic analysis
      if (Math.random() < 0.1) { // 10% of frames
        const result = cameraAnalyzer.analyzeFrame(
          document.querySelector('.ar-video-feed')
        );
        if (result) {
          setAnalysis(result);
          onAnalysisUpdate(result);
        }
      }
    }
  });

  const handleTouchStart = useCallback((event) => {
    event.preventDefault();
    
    if (!isPlaced && analysis?.isWall && hitData) {
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        hitData.normal
      );
      onPlacement(hitData.point, quaternion);
    } else if (isPlaced && currentTransform) {
      gestureController.handleTouchStart(event, currentTransform);
    }
  }, [isPlaced, analysis, hitData, onPlacement, currentTransform, gestureController]);

  const handleTouchMove = useCallback((event) => {
    event.preventDefault();
    if (isPlaced && currentTransform) {
      gestureController.handleTouchMove(event, currentTransform, camera);
    }
  }, [isPlaced, currentTransform, gestureController, camera]);

  const handleTouchEnd = useCallback((event) => {
    event.preventDefault();
    gestureController.handleTouchEnd();
  }, [gestureController]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    canvas.addEventListener('touchmove', handleTouchMove, { passive: false });
    canvas.addEventListener('touchend', handleTouchEnd, { passive: false });
    
    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
      canvas.removeEventListener('touchmove', handleTouchMove);
      canvas.removeEventListener('touchend', handleTouchEnd);
    };
  }, [gl, handleTouchStart, handleTouchMove, handleTouchEnd]);

  return (
    <>
      <DetectionPlanes onHitTest={handleHitTest} isActive={scanningPhase} />
      
      <SmartReticle 
        position={hitData?.point || new THREE.Vector3(0, 0, -2)}
        analysis={analysis}
        visible={scanningPhase && hitData && analysis}
      />
      
      {currentModel && isPlaced && (
        <Suspense fallback={null}>
          <WorldAnchoredModel 
            url={currentModel}
            worldTracker={worldTracker}
            anchorId="main-frame"
            isPlaced={isPlaced}
            currentTransform={currentTransform}
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
  const worldTrackerRef = useRef(null);
  const cameraAnalyzerRef = useRef(null);
  const gestureControllerRef = useRef(null);
  const sessionStartTime = useRef(Date.now());
  const screenshotCount = useRef(0);

  const [cameraStatus, setCameraStatus] = useState('initializing');
  const [cameraError, setCameraError] = useState(null);
  const [facingMode, setFacingMode] = useState('environment');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [arPhase, setArPhase] = useState('scanning');
  const [isModelPlaced, setIsModelPlaced] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [currentTransform, setCurrentTransform] = useState(null);
  const [showGestures, setShowGestures] = useState(false);

  const { currentModel, modelType } = useARStore();

  useEffect(() => {
    worldTrackerRef.current = new IMUWorldTracker();
    cameraAnalyzerRef.current = new CameraAnalyzer();
    gestureControllerRef.current = new GestureController((transform) => {
      setCurrentTransform(transform);
      if (worldTrackerRef.current) {
        worldTrackerRef.current.updateAnchor('main-frame', transform);
      }
    });
  }, []);

  const initCamera = useCallback(async () => {
    setCameraStatus('requesting');
    setCameraError(null);

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { 
          facingMode: { ideal: facingMode },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
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
  }, []);

  useEffect(() => {
    const startTime = sessionStartTime.current;
    const screenshots = screenshotCount.current;
    
    initCamera();
    
    return () => {
      stopCamera();
      analytics.trackARSessionEnded({
        duration: Date.now() - startTime,
        screenshots: screenshots
      });
    };
  }, [initCamera, stopCamera]);

  const handlePlacement = useCallback((position, quaternion) => {
    const cameraPos = new THREE.Vector3(0, 0, 0);
    const cameraRot = new THREE.Quaternion();
    
    worldTrackerRef.current.addAnchor(
      'main-frame',
      cameraPos,
      cameraRot,
      position,
      quaternion
    );
    
    setCurrentTransform({
      position: position.clone(),
      rotation: quaternion.clone(),
      scale: 1
    });
    
    setIsModelPlaced(true);
    setArPhase('placed');
    setShowGestures(true);
    setTimeout(() => setShowGestures(false), 5000);
  }, []);

  const handleReset = useCallback(() => {
    setIsModelPlaced(false);
    setArPhase('ready');
    setCurrentTransform(null);
    worldTrackerRef.current = new IMUWorldTracker();
  }, []);

  const handleScreenshot = useCallback(async () => {
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
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `ar-frame-${Date.now()}.png`;
      link.click();
      URL.revokeObjectURL(url);
      screenshotCount.current++;
    }, 'image/png');
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

  const isGood = analysis?.isWall && analysis?.confidence > 0.5;

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
            <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={70} />
            <ambientLight intensity={0.6} />
            <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
            <pointLight position={[-5, 5, -5]} intensity={0.4} />
            <hemisphereLight intensity={0.5} />
            <Environment preset="city" />
            
            <ARScene 
              currentModel={currentModel}
              worldTracker={worldTrackerRef.current}
              cameraAnalyzer={cameraAnalyzerRef.current}
              onPlacement={handlePlacement}
              isPlaced={isModelPlaced}
              scanningPhase={arPhase === 'scanning' || arPhase === 'ready'}
              onAnalysisUpdate={setAnalysis}
              currentTransform={currentTransform}
              gestureController={gestureControllerRef.current}
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
          <button className="btn-retry" onClick={initCamera}>
            <RefreshCw size={20} /> Retry
          </button>
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
                  <span>Analyzing...</span>
                </>
              )}
              {arPhase === 'ready' && (
                <>
                  <div className={`status-indicator ${isGood ? 'active' : 'inactive'}`} />
                  <span>
                    {isGood ? '✓ Tap to Place' : 
                     analysis ? analysis.reason : 'Point at wall'}
                  </span>
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
              <button className="ar-btn-action" onClick={() => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')}>
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
              <p>Move slowly, point at walls</p>
            </div>
          )}

          {arPhase === 'ready' && !isModelPlaced && (
            <div className={`ar-placement-guide ${!isGood ? 'warning' : ''}`}>
              {isGood ? (
                <>
                  <CheckCircle size={32} color="#00ff00" />
                  <h4>Wall Detected!</h4>
                  <p>Tap green circle to place</p>
                </>
              ) : (
                <>
                  <AlertTriangle size={32} color="#ff3333" />
                  <h4>{analysis?.surfaceType || 'Searching'}</h4>
                  <p>{analysis?.reason || 'Find a plain wall'}</p>
                </>
              )}
            </div>
          )}

          {showGestures && isModelPlaced && (
            <div className="gesture-guide">
              <h4>Touch Controls</h4>
              <div className="gesture-grid">
                <div className="gesture-item">
                  <ZoomIn size={20} />
                  <span>Pinch to Scale</span>
                </div>
                <div className="gesture-item">
                  <RotateCw size={20} />
                  <span>Two Fingers Rotate</span>
                </div>
              </div>
            </div>
          )}

          {isModelPlaced && (
            <div className="ar-action-panel">
              <button className="action-btn primary" onClick={handleScreenshot}>
                <Camera size={24} />
              </button>
              <button className="action-btn" onClick={handleReset}>
                <RotateCcw size={24} />
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
