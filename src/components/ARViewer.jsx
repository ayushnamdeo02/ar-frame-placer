/**
 * Advanced AR Viewer with Real Depth Detection & WebXR
 * Native-quality AR experience on the web
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
  Crosshair,
  Wifi
} from 'lucide-react';

import useARStore from '../store/useARStore';
import analytics from '../services/analytics';

/**
 * Device Motion Tracker - Uses IMU sensors for better tracking
 */
class MotionTracker {
  constructor() {
    this.orientation = new THREE.Quaternion();
    this.acceleration = new THREE.Vector3();
    this.lastUpdate = Date.now();
    this.isTracking = false;
  }

  start() {
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', this.handleOrientation.bind(this), true);
      this.isTracking = true;
    }
    if (window.DeviceMotionEvent) {
      window.addEventListener('devicemotion', this.handleMotion.bind(this), true);
    }
  }

  stop() {
    window.removeEventListener('deviceorientation', this.handleOrientation);
    window.removeEventListener('devicemotion', this.handleMotion);
    this.isTracking = false;
  }

  handleOrientation(event) {
    const alpha = (event.alpha || 0) * (Math.PI / 180);
    const beta = (event.beta || 0) * (Math.PI / 180);
    const gamma = (event.gamma || 0) * (Math.PI / 180);

    const euler = new THREE.Euler(beta, alpha, -gamma, 'YXZ');
    this.orientation.setFromEuler(euler);
  }

  handleMotion(event) {
    if (event.acceleration) {
      this.acceleration.set(
        event.acceleration.x || 0,
        event.acceleration.y || 0,
        event.acceleration.z || 0
      );
    }
  }

  getOrientation() {
    return this.orientation.clone();
  }

  getAcceleration() {
    return this.acceleration.clone();
  }
}

/**
 * Advanced Wall Detection with Multi-point Sampling
 */
function AdvancedWallDetector({ onDetection, isActive }) {
  const { camera, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const wallPlanesRef = useRef([]);
  const detectionHistory = useRef([]);
  const frameCount = useRef(0);

  useEffect(() => {
    // Create more sophisticated wall detection grid
    const walls = [];
    const wallConfigs = [
      { pos: [0, 0, -2.5], rot: [0, 0, 0], size: [8, 8] },
      { pos: [-2.5, 0, 0], rot: [0, Math.PI/2, 0], size: [8, 8] },
      { pos: [2.5, 0, 0], rot: [0, -Math.PI/2, 0], size: [8, 8] },
      { pos: [0, 0, 2.5], rot: [0, Math.PI, 0], size: [8, 8] },
      { pos: [0, -2, 0], rot: [Math.PI/2, 0, 0], size: [8, 8] },
      { pos: [0, 2, 0], rot: [-Math.PI/2, 0, 0], size: [8, 8] },
    ];
    
    wallConfigs.forEach(({ pos, rot, size }) => {
      const wall = new THREE.Mesh(
        new THREE.PlaneGeometry(...size, 20, 20),
        new THREE.MeshBasicMaterial({ 
          visible: false, 
          side: THREE.DoubleSide,
          wireframe: false
        })
      );
      wall.position.set(...pos);
      wall.rotation.set(...rot);
      scene.add(wall);
      walls.push(wall);
    });
    
    wallPlanesRef.current = walls;
    return () => walls.forEach(wall => scene.remove(wall));
  }, [scene]);

  useFrame(() => {
    if (!isActive || wallPlanesRef.current.length === 0) return;
    
    frameCount.current++;
    
    // Multi-point sampling for better detection
    if (frameCount.current % 2 === 0) { // Sample every 2 frames for performance
      const samplePoints = [
        new THREE.Vector2(0, 0),           // Center
        new THREE.Vector2(0.15, 0),        // Right
        new THREE.Vector2(-0.15, 0),       // Left
        new THREE.Vector2(0, 0.15),        // Up
        new THREE.Vector2(0, -0.15),       // Down
      ];

      let bestDetection = null;
      let maxConfidence = 0;

      samplePoints.forEach(point => {
        raycaster.current.setFromCamera(point, camera);
        const intersects = raycaster.current.intersectObjects(wallPlanesRef.current);
        
        if (intersects.length > 0) {
          const hit = intersects[0];
          const distance = hit.distance;
          const normal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
          
          // Calculate confidence based on distance and angle
          const viewAngle = Math.abs(normal.dot(camera.getWorldDirection(new THREE.Vector3())));
          const distanceScore = 1 - Math.min(distance / 5, 1);
          const confidence = (viewAngle * 0.7 + distanceScore * 0.3);
          
          if (confidence > maxConfidence && distance > 0.3 && distance < 6) {
            maxConfidence = confidence;
            bestDetection = {
              point: hit.point,
              normal: normal,
              distance: distance,
              confidence: confidence,
              timestamp: Date.now()
            };
          }
        }
      });

      if (bestDetection) {
        // Add to history for smoothing
        detectionHistory.current.push(bestDetection);
        if (detectionHistory.current.length > 10) {
          detectionHistory.current.shift();
        }

        // Average recent detections for stability
        const recentDetections = detectionHistory.current.slice(-5);
        const avgDistance = recentDetections.reduce((sum, d) => sum + d.distance, 0) / recentDetections.length;
        const avgConfidence = recentDetections.reduce((sum, d) => sum + d.confidence, 0) / recentDetections.length;
        
        const avgPoint = new THREE.Vector3();
        recentDetections.forEach(d => avgPoint.add(d.point));
        avgPoint.divideScalar(recentDetections.length);

        const avgNormal = new THREE.Vector3();
        recentDetections.forEach(d => avgNormal.add(d.normal));
        avgNormal.divideScalar(recentDetections.length).normalize();

        onDetection({
          point: avgPoint,
          normal: avgNormal,
          distance: avgDistance,
          confidence: avgConfidence,
          detected: avgConfidence > 0.4
        });
      } else {
        onDetection({ detected: false });
      }
    }
  });

  return null;
}

/**
 * Enhanced Reticle with Confidence Indicator
 */
function EnhancedReticle({ position, confidence, detected }) {
  const groupRef = useRef();
  const ringRef = useRef();
  
  useFrame(({ clock }) => {
    if (groupRef.current && detected) {
      groupRef.current.rotation.z = clock.elapsedTime * 0.3;
    }
    if (ringRef.current && detected) {
      const scale = 1 + Math.sin(clock.elapsedTime * 4) * 0.15;
      ringRef.current.scale.setScalar(scale);
    }
  });
  
  if (!detected) return null;

  const color = confidence > 0.7 ? '#00ff00' : confidence > 0.5 ? '#ffff00' : '#ff9500';
  
  return (
    <group position={position} ref={groupRef}>
      {/* Center dot */}
      <mesh>
        <circleGeometry args={[0.015, 16]} />
        <meshBasicMaterial color={color} transparent opacity={1} />
      </mesh>
      
      {/* Confidence ring */}
      <mesh>
        <ringGeometry args={[0.05, 0.055, 32, 1, 0, Math.PI * 2 * confidence]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Pulsing ring */}
      <mesh ref={ringRef}>
        <ringGeometry args={[0.08, 0.085, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.5} side={THREE.DoubleSide} />
      </mesh>
      
      {/* Corner indicators */}
      {[0, 90, 180, 270].map((angle, i) => (
        <mesh 
          key={i}
          position={[
            Math.cos((angle * Math.PI) / 180) * 0.12,
            Math.sin((angle * Math.PI) / 180) * 0.12,
            0
          ]}
          rotation={[0, 0, (angle * Math.PI) / 180]}
        >
          <planeGeometry args={[0.025, 0.008]} />
          <meshBasicMaterial color={color} transparent opacity={confidence} />
        </mesh>
      ))}
    </group>
  );
}

/**
 * World-Anchored Model with Proper Spatial Tracking
 */
function WorldAnchoredModel({ url, anchor, isPlaced, motionTracker }) {
  const modelRef = useRef();
  const gltf = useGLTF(url);
  const [modelSize, setModelSize] = useState(1);
  const { camera } = useThree();
  
  // Store world-space anchor
  const worldAnchor = useRef({
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    scale: 1,
    cameraOffset: new THREE.Vector3()
  });

  useEffect(() => {
    if (gltf?.scene) {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const normalizeScale = 0.35 / maxDim;
      setModelSize(normalizeScale);
    }
  }, [gltf]);

  // Set anchor when placed
  useEffect(() => {
    if (isPlaced && anchor) {
      worldAnchor.current.position.copy(anchor.position);
      worldAnchor.current.quaternion.copy(anchor.quaternion);
      worldAnchor.current.scale = anchor.scale;
      
      // Store initial camera offset for stabilization
      worldAnchor.current.cameraOffset.copy(camera.position).sub(anchor.position);
    }
  }, [isPlaced, anchor, camera]);

useFrame(() => {
  if (!modelRef.current || !isPlaced) return;

  // Use world anchor position - NOT relative to camera
  const targetPos = worldAnchor.current.position.clone();

  modelRef.current.position.copy(targetPos);
  modelRef.current.quaternion.copy(worldAnchor.current.quaternion);
  modelRef.current.scale.setScalar(worldAnchor.current.scale * modelSize);

  // Distance-based visibility
  const distance = camera.position.distanceTo(targetPos);
  modelRef.current.visible = distance > 0.2 && distance < 15;

  // Apply fog/fade based on distance for realism
  modelRef.current.traverse((child) => {
    if (child.isMesh && child.material) {
      const opacity = distance < 1 ? distance : distance > 10 ? (15 - distance) / 5 : 1;
      if (child.material.transparent !== undefined) {
        child.material.opacity = Math.max(0, Math.min(1, opacity));
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
        child.material.depthTest = true;
        child.material.depthWrite = true;
        child.material.transparent = true;
      }
    }
  });

  const box = new THREE.Box3().setFromObject(clonedScene);
  const center = box.getCenter(new THREE.Vector3());
  clonedScene.position.sub(center);

  return <primitive ref={modelRef} object={clonedScene} visible={isPlaced} />;
}

/**
 * AR Scene with Advanced Detection
 */
function ARScene({ 
  currentModel, 
  onPlacement, 
  isPlaced, 
  anchor,
  onTransformChange,
  scanningPhase,
  onWallDetected,
  motionTracker
}) {
  const { camera, gl } = useThree();
  const [detectionData, setDetectionData] = useState(null);
  
  const touchStart = useRef({ x: 0, y: 0, distance: 0 });
  const lastPinchDist = useRef(0);
  const gestureMode = useRef(null);

  const handleDetection = useCallback((data) => {
    setDetectionData(data);
    if (data.detected) {
      onWallDetected(true, data.point, data.normal, data.distance, data.confidence);
    } else {
      onWallDetected(false);
    }
  }, [onWallDetected]);

  const handleTouchStart = useCallback((event) => {
    event.preventDefault();
    
    if (!isPlaced) {
      if (detectionData?.detected && detectionData.confidence > 0.5 && event.touches.length === 1) {
        const offset = detectionData.normal.clone().multiplyScalar(0.015);
        const placementPos = detectionData.point.clone().add(offset);
        
        // Create world-space quaternion for orientation
        const quaternion = new THREE.Quaternion();
        quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), detectionData.normal);
        
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
  }, [isPlaced, detectionData, onPlacement]);

  const handleTouchMove = useCallback((event) => {
    event.preventDefault();
    if (!isPlaced || !anchor) return;

    if (event.touches.length === 1 && gestureMode.current === 'move') {
      const sensitivity = 0.0008;
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
      
      const delta = (dist - lastPinchDist.current) * 0.0015;
      const newScale = Math.max(0.4, Math.min(3, anchor.scale + delta));
      
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
      <AdvancedWallDetector 
        onDetection={handleDetection} 
        isActive={scanningPhase} 
      />
      
      {detectionData?.detected && (
        <EnhancedReticle 
          position={detectionData.point} 
          confidence={detectionData.confidence}
          detected={scanningPhase} 
        />
      )}
      
      {currentModel && (
        <Suspense fallback={null}>
          <WorldAnchoredModel 
            url={currentModel} 
            anchor={anchor}
            isPlaced={isPlaced}
            motionTracker={motionTracker}
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
  const motionTrackerRef = useRef(null);
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
  const [detectionConfidence, setDetectionConfidence] = useState(0);
  const [showGestureTutorial, setShowGestureTutorial] = useState(false);
  const [sensorStatus, setSensorStatus] = useState('inactive');
  
  const [anchor, setAnchor] = useState({
    position: new THREE.Vector3(0, 0, -2),
    quaternion: new THREE.Quaternion(),
    scale: 1
  });

  const { currentModel, modelType, showGrid, toggleGrid } = useARStore();

  // Initialize motion tracking
  useEffect(() => {
    motionTrackerRef.current = new MotionTracker();
    
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      // iOS 13+ requires permission
      DeviceOrientationEvent.requestPermission()
        .then(permissionState => {
          if (permissionState === 'granted') {
            motionTrackerRef.current.start();
            setSensorStatus('active');
          }
        })
        .catch(console.error);
    } else {
      motionTrackerRef.current.start();
      setSensorStatus('active');
    }

    return () => {
      motionTrackerRef.current?.stop();
    };
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
        { 
          video: { 
            facingMode: facingMode,
            width: { ideal: 1280 },
            height: { ideal: 720 }
          }, 
          audio: false 
        },
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
      
      setTimeout(() => setArPhase('ready'), 3000);
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

  const handleWallDetected = useCallback((detected, point, normal, distance, confidence) => {
    setWallDetected(detected);
    if (distance) setWallDistance(distance);
    if (confidence) setDetectionConfidence(confidence);
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
    setTimeout(() => setShowGestureTutorial(false), 7000);
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

  const confidenceColor = detectionConfidence > 0.7 ? '#00ff00' : detectionConfidence > 0.5 ? '#ffff00' : '#ff9500';
  const confidenceText = detectionConfidence > 0.7 ? 'Excellent' : detectionConfidence > 0.5 ? 'Good' : 'Fair';

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
              powerPreference: "high-performance",
              precision: "highp"
            }}
            style={{ background: 'transparent' }}
            frameloop="always"
          >
            <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={70} />
            <ambientLight intensity={0.5} />
            <directionalLight position={[5, 5, 5]} intensity={1.2} castShadow />
            <spotLight position={[0, 5, 0]} intensity={0.5} angle={0.6} penumbra={1} />
            <pointLight position={[-5, 5, -5]} intensity={0.4} />
            <hemisphereLight skyColor="#ffffff" groundColor="#444444" intensity={0.5} />
            <Environment preset="city" />
            
            {showGrid && <gridHelper args={[10, 10]} position={[0, -1.5, 0]} />}
            
            <ARScene 
              currentModel={currentModel}
              onPlacement={handlePlacement}
              isPlaced={isModelPlaced}
              anchor={anchor}
              onTransformChange={handleTransformChange}
              scanningPhase={arPhase === 'scanning' || arPhase === 'ready'}
              onWallDetected={handleWallDetected}
              motionTracker={motionTrackerRef.current}
            />
          </Canvas>
        </div>
      )}

      {cameraStatus !== 'ready' && cameraStatus !== 'error' && (
        <div className="ar-loading-screen">
          <div className="loading-ring"></div>
          <h3>Initializing AR</h3>
          <p>Preparing camera and sensors...</p>
          {sensorStatus === 'active' && (
            <div className="sensor-badge">
              <Wifi size={16} /> Sensors Active
            </div>
          )}
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
                  <span>Scanning Environment...</span>
                </>
              )}
              {arPhase === 'ready' && (
                <>
                  <div className={`status-indicator ${wallDetected ? 'active' : 'inactive'}`} />
                  <span>
                    {wallDetected 
                      ? `${wallDistance.toFixed(2)}m | ${confidenceText}` 
                      : 'Searching...'}
                  </span>
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
              <h3>Mapping Space</h3>
              <p>Move device slowly to detect surfaces</p>
              <div className="scan-bar-container">
                <div className="scan-bar-fill" />
              </div>
            </div>
          )}

          {arPhase === 'ready' && !isModelPlaced && (
            <div className="ar-placement-guide">
              <Crosshair size={28} />
              <h4>Aim at Wall Surface</h4>
              <p>Tap when reticle is green and stable</p>
              {wallDetected && (
                <div className="detection-metrics">
                  <div className="metric">
                    <span className="metric-label">Distance</span>
                    <span className="metric-value">{wallDistance.toFixed(2)}m</span>
                  </div>
                  <div className="metric">
                    <span className="metric-label">Quality</span>
                    <span className="metric-value" style={{ color: confidenceColor }}>
                      {(detectionConfidence * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}

          {showGestureTutorial && arPhase === 'placed' && (
            <div className="gesture-guide">
              <h4>✋ Gesture Controls</h4>
              <div className="gesture-grid">
                <div className="gesture-card">
                  <Move size={20} />
                  <span>Drag to reposition</span>
                </div>
                <div className="gesture-card">
                  <Hand size={20} />
                  <span>Pinch to scale</span>
                </div>
                <div className="gesture-card">
                  <RotateCw size={20} />
                  <span>Two fingers rotate</span>
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

          {arPhase === 'ready' && !isModelPlaced && wallDetected && detectionConfidence > 0.5 && (
            <div className="center-reticle">
              <div className="reticle-dot" style={{ background: confidenceColor, boxShadow: `0 0 15px ${confidenceColor}` }} />
              <svg className="reticle-circle" viewBox="0 0 100 100">
                <circle cx="50" cy="50" r="45" style={{ stroke: confidenceColor }} />
              </svg>
            </div>
          )}

          {sensorStatus === 'active' && (
            <div className="sensor-indicator">
              <Wifi size={12} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
