/**
 * Professional AR Viewer - True World Anchoring & Advanced Wall Detection
 * Frame stays fixed in real world space, doesn't follow camera
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
 * Advanced Wall Detection System
 * Uses multiple techniques to identify walls accurately
 */
class AdvancedWallDetector {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.history = [];
  }

  analyzeForWall(video) {
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      return { isWall: false, confidence: 0, reason: 'Camera not ready' };
    }

    // Capture frame at lower resolution for faster processing
    this.canvas.width = 160;
    this.canvas.height = 120;
    this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;

    // Analyze center region (40% of screen)
    const centerX = Math.floor(this.canvas.width / 2);
    const centerY = Math.floor(this.canvas.height / 2);
    const radius = Math.floor(this.canvas.width * 0.2);

    let totalBrightness = 0;
    let totalSaturation = 0;
    let edgePixels = 0;
    let pixelCount = 0;
    
    const colors = [];

    // First pass - collect data
    for (let y = centerY - radius; y <= centerY + radius; y++) {
      for (let x = centerX - radius; x <= centerX + radius; x++) {
        if (x < 0 || x >= this.canvas.width || y < 0 || y >= this.canvas.height) continue;
        
        const i = (y * this.canvas.width + x) * 4;
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        
        const brightness = (r + g + b) / 3;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const saturation = max === 0 ? 0 : (max - min) / max;
        
        totalBrightness += brightness;
        totalSaturation += saturation;
        colors.push({ r, g, b, brightness });
        pixelCount++;

        // Edge detection (check if neighboring pixels are very different)
        if (x > 0 && y > 0) {
          const prevI = ((y - 1) * this.canvas.width + x) * 4;
          const diff = Math.abs(data[i] - data[prevI]) + 
                      Math.abs(data[i + 1] - data[prevI + 1]) + 
                      Math.abs(data[i + 2] - data[prevI + 2]);
          if (diff > 90) edgePixels++;
        }
      }
    }

    const avgBrightness = totalBrightness / pixelCount;
    const avgSaturation = totalSaturation / pixelCount;
    const edgeDensity = edgePixels / pixelCount;

    // Calculate color uniformity
    let variance = 0;
    colors.forEach(c => {
      variance += Math.pow(c.brightness - avgBrightness, 2);
    });
    variance = Math.sqrt(variance / pixelCount);
    const uniformity = 1 / (1 + variance / 50);

    // Analyze bottom vs center (floor detection)
    const bottomY = Math.floor(this.canvas.height * 0.8);
    let bottomBrightness = 0;
    let bottomCount = 0;
    
    for (let y = bottomY; y < this.canvas.height; y++) {
      for (let x = 0; x < this.canvas.width; x++) {
        const i = (y * this.canvas.width + x) * 4;
        bottomBrightness += (data[i] + data[i + 1] + data[i + 2]) / 3;
        bottomCount++;
      }
    }
    bottomBrightness /= bottomCount;

    // Classification logic
    let surfaceType = 'unknown';
    let confidence = 0;
    let reason = '';
    let isWall = false;

    // Wall characteristics:
    // - Uniform color (low variance)
    // - Medium brightness (not too bright like window, not too dark like floor)
    // - Low edge density (not textured)
    // - Low saturation (walls are usually neutral colors)
    // - Similar brightness top and bottom (vertical surface)

    const brightnessGradient = Math.abs(avgBrightness - bottomBrightness);
    
    // WALL DETECTION
    if (
      uniformity > 0.65 &&                    // Very uniform
      avgBrightness > 60 && avgBrightness < 200 &&  // Medium brightness
      edgeDensity < 0.08 &&                   // Few edges
      avgSaturation < 0.4 &&                  // Low saturation
      brightnessGradient < 40                 // Uniform top to bottom (vertical)
    ) {
      surfaceType = 'wall';
      isWall = true;
      confidence = Math.min(0.95, uniformity * 0.4 + (1 - edgeDensity) * 0.3 + (1 - avgSaturation) * 0.3);
      reason = 'Clean wall detected';
    }
    // FLOOR DETECTION
    else if (
      brightnessGradient > 50 ||              // Gradient indicates looking down
      (avgBrightness < 80 && edgeDensity > 0.1)  // Dark and textured
    ) {
      surfaceType = 'floor';
      confidence = 0.15;
      reason = 'Floor detected - aim higher';
      isWall = false;
    }
    // WINDOW/BRIGHT AREA
    else if (avgBrightness > 200 || (avgBrightness > 180 && uniformity > 0.8)) {
      surfaceType = 'window';
      confidence = 0.2;
      reason = 'Window or bright area';
      isWall = false;
    }
    // TEXTURED SURFACE
    else if (edgeDensity > 0.15 || uniformity < 0.4) {
      surfaceType = 'textured';
      confidence = 0.25;
      reason = 'Too much texture/detail';
      isWall = false;
    }
    // CEILING
    else if (avgBrightness > 160 && brightnessGradient > 30 && bottomBrightness < avgBrightness) {
      surfaceType = 'ceiling';
      confidence = 0.2;
      reason = 'Ceiling - aim lower';
      isWall = false;
    }
    // UNCERTAIN
    else {
      surfaceType = 'uncertain';
      confidence = 0.3;
      reason = 'Move camera slowly';
      isWall = false;
    }

    // Smooth results over time
    this.history.push({ isWall, confidence, surfaceType });
    if (this.history.length > 5) this.history.shift();

    // Require consistent wall detection
    const recentWalls = this.history.filter(h => h.isWall).length;
    const finalIsWall = recentWalls >= 3; // Need 3 out of last 5 frames
    const finalConfidence = finalIsWall ? Math.min(...this.history.slice(-3).map(h => h.confidence)) : confidence;

    return {
      isWall: finalIsWall,
      confidence: finalConfidence,
      surfaceType,
      reason: finalIsWall ? 'Stable wall detected' : reason,
      metrics: {
        uniformity: uniformity.toFixed(2),
        brightness: avgBrightness.toFixed(0),
        edgeDensity: edgeDensity.toFixed(2),
        saturation: avgSaturation.toFixed(2)
      }
    };
  }
}

/**
 * True World Space Tracker
 * Maintains absolute world coordinates independent of camera
 */
class WorldSpaceTracker {
  constructor() {
    this.anchors = new Map();
    this.initialCameraState = null;
  }

  // Called once when frame is placed
  createAnchor(id, cameraPosition, cameraQuaternion, targetWorldPosition, targetWorldQuaternion) {
    // Store the camera's state at placement time
    if (!this.initialCameraState) {
      this.initialCameraState = {
        position: cameraPosition.clone(),
        quaternion: cameraQuaternion.clone()
      };
    }

    // Store anchor in absolute world coordinates
    this.anchors.set(id, {
      worldPosition: targetWorldPosition.clone(),
      worldQuaternion: targetWorldQuaternion.clone(),
      initialCameraPosition: cameraPosition.clone(),
      initialCameraQuaternion: cameraQuaternion.clone(),
      scale: 1
    });

    console.log('🎯 Anchor created at world position:', targetWorldPosition);
  }

  // Called every frame to get where to render the model
  getModelTransform(id, currentCamera) {
    const anchor = this.anchors.get(id);
    if (!anchor) return null;

    // Calculate how much the camera has moved since placement
    const cameraDelta = new THREE.Vector3()
      .subVectors(currentCamera.position, anchor.initialCameraPosition);

    // The model's position relative to current camera = 
    // original world position - camera movement
    const modelPosition = anchor.worldPosition.clone().sub(cameraDelta);

    return {
      position: modelPosition,
      quaternion: anchor.worldQuaternion.clone(),
      scale: anchor.scale
    };
  }

  updateAnchor(id, updates) {
    const anchor = this.anchors.get(id);
    if (!anchor) return;

    if (updates.position) {
      // When updating position via gesture, update the world position
      const cameraDelta = new THREE.Vector3()
        .subVectors(updates.cameraPosition || new THREE.Vector3(), anchor.initialCameraPosition);
      anchor.worldPosition.copy(updates.position).add(cameraDelta);
    }
    if (updates.quaternion) anchor.worldQuaternion.copy(updates.quaternion);
    if (updates.scale !== undefined) anchor.scale = updates.scale;
  }

  reset() {
    this.anchors.clear();
    this.initialCameraState = null;
  }
}

/**
 * Gesture Controller
 */
class GestureController {
  constructor(onUpdate) {
    this.onUpdate = onUpdate;
    this.initialTouch = null;
    this.initialPinch = null;
    this.mode = null;
  }

  start(event, currentTransform) {
    if (event.touches.length === 1) {
      this.mode = 'pan';
      this.initialTouch = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY
      };
    } else if (event.touches.length === 2) {
      this.mode = 'pinch-rotate';
      const dx = event.touches[1].clientX - event.touches[0].clientX;
      const dy = event.touches[1].clientY - event.touches[0].clientY;
      this.initialPinch = {
        distance: Math.sqrt(dx * dx + dy * dy),
        angle: Math.atan2(dy, dx),
        scale: currentTransform.scale
      };
    }
  }

  move(event, currentTransform, camera) {
    if (this.mode === 'pan' && event.touches.length === 1) {
      const dx = (event.touches[0].clientX - this.initialTouch.x) * 0.002;
      const dy = -(event.touches[0].clientY - this.initialTouch.y) * 0.002;
      
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0);
      
      const newPosition = currentTransform.position.clone()
        .add(right.multiplyScalar(dx))
        .add(up.multiplyScalar(dy));
      
      this.onUpdate({
        position: newPosition,
        quaternion: currentTransform.quaternion,
        scale: currentTransform.scale,
        cameraPosition: camera.position
      });
      
      this.initialTouch = {
        x: event.touches[0].clientX,
        y: event.touches[0].clientY
      };
    }
    else if (this.mode === 'pinch-rotate' && event.touches.length === 2) {
      const dx = event.touches[1].clientX - event.touches[0].clientX;
      const dy = event.touches[1].clientY - event.touches[0].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      
      // Scale
      const scaleRatio = distance / this.initialPinch.distance;
      const newScale = Math.max(0.3, Math.min(3, this.initialPinch.scale * scaleRatio));
      
      // Rotation
      const angleDelta = angle - this.initialPinch.angle;
      const rotQuat = new THREE.Quaternion();
      rotQuat.setFromAxisAngle(new THREE.Vector3(0, 0, 1), angleDelta);
      const newQuaternion = currentTransform.quaternion.clone().multiply(rotQuat);
      
      this.onUpdate({
        position: currentTransform.position,
        quaternion: newQuaternion,
        scale: newScale,
        cameraPosition: camera.position
      });
    }
  }

  end() {
    this.mode = null;
    this.initialTouch = null;
    this.initialPinch = null;
  }
}

/**
 * Enhanced Reticle
 */
function EnhancedReticle({ position, analysis, visible }) {
  const groupRef = useRef();
  const pulseRef = useRef();
  
  useFrame(({ clock }) => {
    if (groupRef.current && visible) {
      groupRef.current.rotation.z = clock.elapsedTime * 0.5;
    }
    if (pulseRef.current && visible) {
      const scale = 1 + Math.sin(clock.elapsedTime * 4) * 0.12;
      pulseRef.current.scale.setScalar(scale);
    }
  });
  
  if (!visible) return null;

  const isGood = analysis?.isWall && analysis?.confidence > 0.7;
  const color = isGood ? '#00ff00' : '#ff3333';
  const size = isGood ? 1.2 : 0.8;
  
  return (
    <group position={position} ref={groupRef}>
      <mesh>
        <circleGeometry args={[0.025 * size, 32]} />
        <meshBasicMaterial color={color} transparent opacity={1} depthTest={false} />
      </mesh>
      
      <mesh>
        <ringGeometry args={[0.08 * size, 0.09 * size, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      
      <mesh ref={pulseRef}>
        <ringGeometry args={[0.13 * size, 0.14 * size, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.6} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      
      {isGood && [0, 90, 180, 270].map((angle, i) => (
        <group key={i} rotation={[0, 0, (angle * Math.PI) / 180]}>
          <mesh position={[0.18 * size, 0, 0]}>
            <planeGeometry args={[0.05, 0.012]} />
            <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
          </mesh>
        </group>
      ))}
      
      {!isGood && (
        <>
          <mesh rotation={[0, 0, Math.PI / 4]}>
            <planeGeometry args={[0.22, 0.03]} />
            <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
          </mesh>
          <mesh rotation={[0, 0, -Math.PI / 4]}>
            <planeGeometry args={[0.22, 0.03]} />
            <meshBasicMaterial color={color} transparent opacity={0.9} depthTest={false} />
          </mesh>
        </>
      )}
    </group>
  );
}

/**
 * World-Anchored Model
 */
function WorldAnchoredModel({ url, worldTracker, anchorId, isPlaced, activeTransform }) {
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
    if (!modelRef.current || !isPlaced) return;

    // Use active transform during gestures, otherwise get from world tracker
    let transform;
    if (activeTransform) {
      transform = activeTransform;
    } else {
      transform = worldTracker?.getModelTransform(anchorId, camera);
    }

    if (!transform) return;

    modelRef.current.position.copy(transform.position);
    modelRef.current.quaternion.copy(transform.quaternion);
    modelRef.current.scale.setScalar(transform.scale * modelSize);
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
 * Hit Test System
 */
function HitTestSystem({ onHit, isActive }) {
  const { camera, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const planes = useRef([]);

  useEffect(() => {
    const distances = [0.8, 1.2, 1.6, 2.0, 2.5, 3.0];
    const newPlanes = [];
    
    distances.forEach(dist => {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(10, 10),
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
      );
      plane.position.set(0, 0, -dist);
      plane.userData.distance = dist;
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
      onHit({
        point: hit.point,
        distance: hit.object.userData.distance,
        normal: new THREE.Vector3(0, 0, 1)
      });
    }
  });

  return null;
}

/**
 * AR Scene
 */
function ARScene({ 
  currentModel,
  worldTracker,
  wallDetector,
  onPlacement,
  isPlaced,
  scanningPhase,
  onAnalysisUpdate,
  activeTransform,
  gestureController
}) {
  const { camera, gl } = useThree();
  const [hitData, setHitData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const frameCount = useRef(0);

  useFrame(() => {
    if (scanningPhase && wallDetector) {
      frameCount.current++;
      // Analyze every 3 frames for performance
      if (frameCount.current % 3 === 0) {
        const video = document.querySelector('.ar-video-feed');
        const result = wallDetector.analyzeForWall(video);
        setAnalysis(result);
        onAnalysisUpdate(result);
      }
    }
  });

  const handleTouchStart = useCallback((event) => {
    event.preventDefault();
    
    if (!isPlaced && analysis?.isWall && analysis?.confidence > 0.7 && hitData) {
      // Place frame
      const quaternion = new THREE.Quaternion();
      quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hitData.normal);
      onPlacement(hitData.point, quaternion, camera.position, camera.quaternion);
    } else if (isPlaced && activeTransform) {
      // Start gesture
      gestureController.start(event, activeTransform);
    }
  }, [isPlaced, analysis, hitData, onPlacement, camera, activeTransform, gestureController]);

  const handleTouchMove = useCallback((event) => {
    event.preventDefault();
    if (isPlaced && activeTransform) {
      gestureController.move(event, activeTransform, camera);
    }
  }, [isPlaced, activeTransform, gestureController, camera]);

  const handleTouchEnd = useCallback((event) => {
    event.preventDefault();
    gestureController.end();
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
      <HitTestSystem onHit={setHitData} isActive={scanningPhase} />
      
      <EnhancedReticle 
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
            activeTransform={activeTransform}
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
  const wallDetectorRef = useRef(null);
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
  const [activeTransform, setActiveTransform] = useState(null);

  const { currentModel, modelType } = useARStore();

  useEffect(() => {
    worldTrackerRef.current = new WorldSpaceTracker();
    wallDetectorRef.current = new AdvancedWallDetector();
    gestureControllerRef.current = new GestureController((transform) => {
      setActiveTransform(transform);
      worldTrackerRef.current?.updateAnchor('main-frame', transform);
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

  const handlePlacement = useCallback((position, quaternion, cameraPos, cameraQuat) => {
    worldTrackerRef.current.createAnchor(
      'main-frame',
      cameraPos,
      cameraQuat,
      position,
      quaternion
    );
    
    setActiveTransform({
      position: position.clone(),
      quaternion: quaternion.clone(),
      scale: 1
    });
    
    setIsModelPlaced(true);
    setArPhase('placed');
  }, []);

  const handleReset = useCallback(() => {
    setIsModelPlaced(false);
    setArPhase('ready');
    setActiveTransform(null);
    worldTrackerRef.current?.reset();
    wallDetectorRef.current = new AdvancedWallDetector();
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

  const isGood = analysis?.isWall && analysis?.confidence > 0.7;

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
              wallDetector={wallDetectorRef.current}
              onPlacement={handlePlacement}
              isPlaced={isModelPlaced}
              scanningPhase={arPhase === 'scanning' || arPhase === 'ready'}
              onAnalysisUpdate={setAnalysis}
              activeTransform={activeTransform}
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
                  <span>Calibrating...</span>
                </>
              )}
              {arPhase === 'ready' && (
                <>
                  <div className={`status-indicator ${isGood ? 'active' : 'inactive'}`} />
                  <span>
                    {isGood ? '✓ TAP TO PLACE' : 
                     analysis ? analysis.reason : 'Find wall'}
                  </span>
                </>
              )}
              {arPhase === 'placed' && (
                <>
                  <div className="status-indicator success" />
                  <span>Frame Anchored ✓</span>
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
              <h3>Analyzing Environment</h3>
              <p>Point at a plain wall</p>
              <div className="scan-bar-container">
                <div className="scan-bar-fill" />
              </div>
            </div>
          )}

          {arPhase === 'ready' && !isModelPlaced && (
            <div className={`ar-placement-guide ${!isGood ? 'warning' : ''}`}>
              {isGood ? (
                <>
                  <CheckCircle size={36} color="#00ff00" />
                  <h4>Perfect Wall!</h4>
                  <p>Tap green reticle to place frame</p>
                  {analysis?.metrics && (
                    <small style={{opacity: 0.7, marginTop: '0.5rem'}}>
                      Quality: {(analysis.confidence * 100).toFixed(0)}%
                    </small>
                  )}
                </>
              ) : (
                <>
                  <AlertTriangle size={36} color="#ff3333" />
                  <h4>{analysis?.surfaceType || 'Scanning...'}</h4>
                  <p>{analysis?.reason || 'Move camera to find wall'}</p>
                  <small style={{opacity: 0.6, marginTop: '0.5rem'}}>
                    Walls only - no floor/ceiling/windows
                  </small>
                </>
              )}
            </div>
          )}

          {isModelPlaced && (
            <>
              <div className="ar-instructions">
                <p>🤏 Pinch to scale • ✋ Drag to move • 🔄 Two fingers rotate</p>
              </div>
              
              <div className="ar-action-panel">
                <button className="action-btn primary" onClick={handleScreenshot}>
                  <Camera size={24} />
                </button>
                <button className="action-btn" onClick={handleReset}>
                  <RotateCcw size={24} />
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
