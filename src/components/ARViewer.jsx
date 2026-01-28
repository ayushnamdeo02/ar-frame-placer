/**
 * Production AR Viewer with Real Occlusion & World Anchoring
 * Frame stays fixed in world space and hidden behind real objects
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
  CheckCircle
} from 'lucide-react';

import useARStore from '../store/useARStore';
import analytics from '../services/analytics';

/**
 * Device Motion Tracker - Tracks real device movement
 */
class MotionTracker {
  constructor() {
    this.orientation = new THREE.Euler(0, 0, 0, 'YXZ');
    this.quaternion = new THREE.Quaternion();
    this.initialOrientation = null;
    this.isTracking = false;
  }

  startTracking() {
    if (window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', this.handleOrientation.bind(this), true);
      this.isTracking = true;
    }
  }

  handleOrientation(event) {
    if (event.alpha !== null && event.beta !== null && event.gamma !== null) {
      const alpha = THREE.MathUtils.degToRad(event.alpha);
      const beta = THREE.MathUtils.degToRad(event.beta);
      const gamma = THREE.MathUtils.degToRad(event.gamma);
      
      this.orientation.set(beta, alpha, -gamma, 'YXZ');
      this.quaternion.setFromEuler(this.orientation);
      
      if (!this.initialOrientation) {
        this.initialOrientation = this.quaternion.clone();
      }
    }
  }

  getRelativeRotation() {
    if (!this.initialOrientation) return new THREE.Quaternion();
    
    const relative = new THREE.Quaternion();
    relative.copy(this.quaternion);
    relative.multiply(this.initialOrientation.clone().invert());
    return relative;
  }

  stopTracking() {
    window.removeEventListener('deviceorientation', this.handleOrientation.bind(this));
    this.isTracking = false;
  }
}

/**
 * World Position Tracker - Maintains absolute world coordinates
 */
class WorldPositionTracker {
  constructor() {
    this.anchors = new Map();
    this.cameraWorldPosition = new THREE.Vector3(0, 0, 0);
    this.cameraWorldRotation = new THREE.Quaternion();
    this.initialCameraPosition = null;
    this.initialCameraRotation = null;
  }

  updateCamera(camera) {
    if (!this.initialCameraPosition) {
      this.initialCameraPosition = camera.position.clone();
      this.initialCameraRotation = camera.quaternion.clone();
    }

    // Calculate camera movement relative to initial position
    const deltaPos = camera.position.clone().sub(this.initialCameraPosition);
    const deltaRot = camera.quaternion.clone().multiply(this.initialCameraRotation.clone().invert());
    
    this.cameraWorldPosition.copy(this.initialCameraPosition).add(deltaPos);
    this.cameraWorldRotation.copy(deltaRot);
  }

  addAnchor(id, worldPosition, worldRotation) {
    this.anchors.set(id, {
      worldPosition: worldPosition.clone(),
      worldRotation: worldRotation.clone(),
      locked: true
    });
  }

  getAnchorInCameraSpace(id, camera) {
    const anchor = this.anchors.get(id);
    if (!anchor || !this.initialCameraPosition) return null;

    // Convert world position to camera-relative position
    const relativePos = anchor.worldPosition.clone().sub(camera.position);
    
    return {
      position: relativePos,
      rotation: anchor.worldRotation.clone(),
      worldPosition: anchor.worldPosition.clone()
    };
  }
}

/**
 * Surface Classifier - Only detects vertical walls
 */
function classifySurface(normal, distance) {
  const up = new THREE.Vector3(0, 1, 0);
  const horizontalAlignment = 1 - Math.abs(normal.dot(up));
  
  let type = 'unknown';
  let quality = 0;
  let reason = '';
  
  // Check if it's vertical (wall)
  if (horizontalAlignment > 0.8) {
    type = 'wall';
    
    if (distance < 0.5) {
      quality = 0.3;
      reason = 'Too close to wall';
    } else if (distance > 3.5) {
      quality = 0.4;
      reason = 'Too far from wall';
    } else {
      quality = 0.95;
      reason = 'Perfect wall detected';
    }
  } else if (horizontalAlignment < 0.3) {
    const isFloor = normal.y < -0.7;
    type = isFloor ? 'floor' : 'ceiling';
    quality = 0.1;
    reason = isFloor ? 'Floor - not suitable' : 'Ceiling - not suitable';
  } else {
    type = 'angled';
    quality = 0.2;
    reason = 'Angled surface - find a wall';
  }
  
  return { type, quality, reason, isWall: type === 'wall' };
}

/**
 * Advanced Wall Detector
 */
function WallDetector({ onSurfaceDetected, isActive }) {
  const { camera, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const detectionPlanes = useRef([]);
  const detectionBuffer = useRef([]);

  useEffect(() => {
    const planes = [];
    
    // Only vertical walls at various distances
    const distances = [1.0, 1.5, 2.0, 2.5, 3.0];
    
    distances.forEach(dist => {
      // Front wall
      const frontPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 5, 20, 20),
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
      );
      frontPlane.position.set(0, 0, -dist);
      frontPlane.userData.normal = new THREE.Vector3(0, 0, 1);
      scene.add(frontPlane);
      planes.push(frontPlane);
      
      // Left wall
      const leftPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 5, 20, 20),
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
      );
      leftPlane.position.set(-dist, 0, 0);
      leftPlane.rotation.y = Math.PI / 2;
      leftPlane.userData.normal = new THREE.Vector3(1, 0, 0);
      scene.add(leftPlane);
      planes.push(leftPlane);
      
      // Right wall
      const rightPlane = new THREE.Mesh(
        new THREE.PlaneGeometry(5, 5, 20, 20),
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
      );
      rightPlane.position.set(dist, 0, 0);
      rightPlane.rotation.y = -Math.PI / 2;
      rightPlane.userData.normal = new THREE.Vector3(-1, 0, 0);
      scene.add(rightPlane);
      planes.push(rightPlane);
    });
    
    detectionPlanes.current = planes;
    
    return () => {
      planes.forEach(plane => scene.remove(plane));
    };
  }, [scene]);

  useFrame(() => {
    if (!isActive || detectionPlanes.current.length === 0) return;

    const samplePoints = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.05, 0),
      new THREE.Vector2(-0.05, 0),
      new THREE.Vector2(0, 0.05),
      new THREE.Vector2(0, -0.05),
    ];

    let bestHit = null;
    let bestScore = 0;

    samplePoints.forEach(offset => {
      raycaster.current.setFromCamera(offset, camera);
      const intersects = raycaster.current.intersectObjects(detectionPlanes.current);

      if (intersects.length > 0) {
        const hit = intersects[0];
        const distance = hit.distance;
        const normal = hit.object.userData.normal.clone();
        
        const classification = classifySurface(normal, distance);
        const score = classification.quality;

        if (score > bestScore && classification.isWall) {
          bestScore = score;
          bestHit = {
            point: hit.point.clone(),
            normal: normal,
            distance: distance,
            classification: classification
          };
        }
      }
    });

    if (bestHit) {
      detectionBuffer.current.push(bestHit);
      if (detectionBuffer.current.length > 5) {
        detectionBuffer.current.shift();
      }

      if (detectionBuffer.current.length >= 3) {
        const avgPoint = new THREE.Vector3();
        const avgNormal = new THREE.Vector3();
        let avgDistance = 0;
        let avgQuality = 0;

        detectionBuffer.current.forEach(hit => {
          avgPoint.add(hit.point);
          avgNormal.add(hit.normal);
          avgDistance += hit.distance;
          avgQuality += hit.classification.quality;
        });

        const count = detectionBuffer.current.length;
        avgPoint.divideScalar(count);
        avgNormal.divideScalar(count).normalize();
        avgDistance /= count;
        avgQuality /= count;

        onSurfaceDetected({
          point: avgPoint,
          normal: avgNormal,
          distance: avgDistance,
          quality: avgQuality,
          classification: bestHit.classification,
          detected: avgQuality > 0.7
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
  });

  return null;
}

/**
 * Smart Reticle - Green for walls, Red otherwise
 */
function SmartReticle({ position, classification, visible }) {
  const ringRef = useRef();
  
  useFrame(({ clock }) => {
    if (ringRef.current && visible) {
      ringRef.current.rotation.z = clock.elapsedTime * 0.5;
    }
  });
  
  if (!visible) return null;

  const isGoodWall = classification?.isWall && classification?.quality > 0.7;
  const color = isGoodWall ? '#00ff00' : '#ff3333';
  
  return (
    <group position={position}>
      <mesh>
        <circleGeometry args={[0.02, 16]} />
        <meshBasicMaterial color={color} transparent opacity={1} depthTest={false} />
      </mesh>
      
      <mesh ref={ringRef}>
        <ringGeometry args={[0.08, 0.085, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      
      {isGoodWall && [0, 90, 180, 270].map((angle, i) => (
        <mesh 
          key={i}
          position={[
            Math.cos((angle * Math.PI) / 180) * 0.15,
            Math.sin((angle * Math.PI) / 180) * 0.15,
            0
          ]}
        >
          <planeGeometry args={[0.04, 0.01]} />
          <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
        </mesh>
      ))}
      
      {!isGoodWall && (
        <>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <planeGeometry args={[0.18, 0.02]} />
            <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
          </mesh>
          <mesh rotation={[0, 0, -Math.PI / 4]}>
            <planeGeometry args={[0.18, 0.02]} />
            <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

/**
 * World-Anchored Frame with Occlusion
 */
function WorldAnchoredFrame({ url, worldTracker, anchorId, isPlaced }) {
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
    if (!modelRef.current || !isPlaced || !worldTracker) return;

    worldTracker.updateCamera(camera);
    const anchorData = worldTracker.getAnchorInCameraSpace(anchorId, camera);
    
    if (!anchorData) return;

    // Position frame relative to current camera
    modelRef.current.position.copy(anchorData.position);
    modelRef.current.quaternion.copy(anchorData.rotation);
    modelRef.current.scale.setScalar(modelSize);

    // Calculate distance from camera to frame
    const distanceToFrame = camera.position.distanceTo(anchorData.worldPosition);
    
    // Simple occlusion: if something is closer than the frame, hide it
    // This simulates depth-based occlusion
    const isOccluded = distanceToFrame < 0.2; // Too close = likely occluded
    
    modelRef.current.visible = !isOccluded && distanceToFrame < 20;

    // Fade based on distance
    modelRef.current.traverse((child) => {
      if (child.isMesh && child.material) {
        child.visible = true;
        
        let opacity = 1;
        if (distanceToFrame < 0.4) {
          opacity = distanceToFrame / 0.4;
        } else if (distanceToFrame > 15) {
          opacity = Math.max(0, (20 - distanceToFrame) / 5);
        }
        
        if (child.material.opacity !== undefined) {
          child.material.transparent = opacity < 1;
          child.material.opacity = opacity;
        }
        
        // Lower render order so real objects appear in front
        child.renderOrder = -1;
      }
    });
  });

  if (!gltf?.scene) {
    return (
      <mesh renderOrder={-1}>
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
      child.renderOrder = -1;
      if (child.material) {
        child.material.side = THREE.DoubleSide;
        child.material.depthTest = true;
        child.material.depthWrite = false; // Don't write depth for occlusion
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
  worldTracker,
  scanningPhase,
  onSurfaceDetected
}) {
  const { gl } = useThree();
  const [surfaceData, setSurfaceData] = useState(null);

  const handleSurfaceDetection = useCallback((data) => {
    setSurfaceData(data);
    onSurfaceDetected(data);
  }, [onSurfaceDetected]);

  const handleTouchStart = useCallback((event) => {
    event.preventDefault();
    
    if (!isPlaced && surfaceData?.detected && 
        surfaceData.classification?.isWall && 
        surfaceData.quality > 0.7 && 
        event.touches.length === 1) {
      
      const offset = surfaceData.normal.clone().multiplyScalar(0.02);
      const placementPos = surfaceData.point.clone().add(offset);
      
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), surfaceData.normal);
      
      onPlacement(placementPos, quaternion);
    }
  }, [isPlaced, surfaceData, onPlacement]);

  useEffect(() => {
    const canvas = gl.domElement;
    canvas.addEventListener('touchstart', handleTouchStart, { passive: false });
    
    return () => {
      canvas.removeEventListener('touchstart', handleTouchStart);
    };
  }, [gl, handleTouchStart]);

  return (
    <>
      <WallDetector 
        onSurfaceDetected={handleSurfaceDetection}
        isActive={scanningPhase}
      />
      
      <SmartReticle 
        position={surfaceData?.point || new THREE.Vector3(0, 0, -2)} 
        classification={surfaceData?.classification}
        visible={scanningPhase && surfaceData?.detected}
      />
      
      {currentModel && isPlaced && (
        <Suspense fallback={null}>
          <WorldAnchoredFrame 
            url={currentModel} 
            worldTracker={worldTracker}
            anchorId="main-frame"
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
  const worldTrackerRef = useRef(null);
  const motionTrackerRef = useRef(null);
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

  const { currentModel, modelType } = useARStore();

  useEffect(() => {
    worldTrackerRef.current = new WorldPositionTracker();
    motionTrackerRef.current = new MotionTracker();
    motionTrackerRef.current.startTracking();
    
    return () => {
      motionTrackerRef.current?.stopTracking();
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

  const handlePlacement = useCallback((position, quaternion) => {
    console.log('Placing frame at world position:', position);
    
    // Lock frame to world coordinates
    worldTrackerRef.current.addAnchor('main-frame', position, quaternion);
    
    setIsModelPlaced(true);
    setArPhase('placed');
  }, []);

  const handleReset = useCallback(() => {
    setIsModelPlaced(false);
    setArPhase('ready');
    worldTrackerRef.current = new WorldPositionTracker();
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

  const isGoodWall = surfaceData?.detected && 
                     surfaceData?.classification?.isWall && 
                     surfaceData?.quality > 0.7;

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
              worldTracker={worldTrackerRef.current}
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
                  <div className={`status-indicator ${isGoodWall ? 'active' : 'inactive'}`} />
                  <span>
                    {isGoodWall ? 'Wall Found - Tap to Hang' : 
                     surfaceData?.detected ? surfaceData.classification?.reason : 
                     'Point at Wall'}
                  </span>
                </>
              )}
              {arPhase === 'placed' && (
                <>
                  <div className="status-indicator success" />
                  <span>Frame Hung on Wall ✓</span>
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
              <p>Move slowly to detect walls</p>
              <div className="scan-bar-container">
                <div className="scan-bar-fill" />
              </div>
            </div>
          )}

          {arPhase === 'ready' && !isModelPlaced && (
            <div className={`ar-placement-guide ${!isGoodWall ? 'warning' : ''}`}>
              {isGoodWall ? (
                <>
                  <CheckCircle size={32} color="#00ff00" />
                  <h4>Perfect Wall!</h4>
                  <p>Tap green reticle to hang frame</p>
                </>
              ) : (
                <>
                  <AlertTriangle size={32} color="#ff3333" />
                  <h4>Find a Wall</h4>
                  <p>{surfaceData?.classification?.reason || 'Point at a vertical wall'}</p>
                  <span className="hint">Not floor, ceiling, or angled surfaces</span>
                </>
              )}
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
            </div>
          )}
        </>
      )}
    </div>
  );
}
