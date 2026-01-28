/**
 * ADVANCED AR VIEWER - Pure Computer Vision
 * No TensorFlow - Pure JavaScript CV algorithms
 */
import React, { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, useGLTF, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { 
  X, Camera, RotateCcw, RefreshCw,
  AlertTriangle, CheckCircle, Zap
} from 'lucide-react';

import useARStore from '../store/useARStore';
import analytics from '../services/analytics';

/**
 * Pure JavaScript Computer Vision Wall Detector
 */
class PureJSWallDetector {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.history = [];
  }

  async analyzeForWall(video) {
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      return { 
        isWall: false, 
        confidence: 0, 
        reason: 'Camera starting...', 
        surfaceType: 'unknown' 
      };
    }

    this.canvas.width = 320;
    this.canvas.height = 240;
    this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Center region analysis
    const startX = Math.floor(width * 0.2);
    const endX = Math.floor(width * 0.8);
    const startY = Math.floor(height * 0.2);
    const endY = Math.floor(height * 0.8);

    let brightSum = 0;
    let satSum = 0;
    let edgeCount = 0;
    let pixelCount = 0;
    const brightnesses = [];

    for (let y = startY; y < endY; y++) {
      for (let x = startX; x < endX; x++) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        
        const bright = (r + g + b) / 3;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const sat = max === 0 ? 0 : (max - min) / max;
        
        brightSum += bright;
        satSum += sat;
        brightnesses.push(bright);
        pixelCount++;

        // Edge detection
        if (x > startX && y > startY) {
          const prevIdx = ((y - 1) * width + x) * 4;
          const diff = Math.abs(data[idx] - data[prevIdx]);
          if (diff > 40) edgeCount++;
        }
      }
    }

    const avgBright = brightSum / pixelCount;
    const avgSat = satSum / pixelCount;
    const edgeDensity = edgeCount / pixelCount;

    // Calculate uniformity
    let variance = 0;
    brightnesses.forEach(b => variance += Math.pow(b - avgBright, 2));
    variance = Math.sqrt(variance / pixelCount);
    const uniformity = 1 / (1 + variance / 40);

    // Vertical gradient (floor/ceiling detection)
    let topBright = 0, bottomBright = 0, topCount = 0, bottomCount = 0;
    
    for (let x = startX; x < endX; x++) {
      const topIdx = (Math.floor(height * 0.15) * width + x) * 4;
      const bottomIdx = (Math.floor(height * 0.85) * width + x) * 4;
      topBright += (data[topIdx] + data[topIdx + 1] + data[topIdx + 2]) / 3;
      bottomBright += (data[bottomIdx] + data[bottomIdx + 1] + data[bottomIdx + 2]) / 3;
      topCount++;
      bottomCount++;
    }
    
    topBright /= topCount;
    bottomBright /= bottomCount;
    const gradient = bottomBright - topBright;

    // Decision logic
    let isWall = false;
    let confidence = 0;
    let reason = '';
    let surfaceType = 'unknown';

    if (avgBright > 230) {
      surfaceType = 'window';
      reason = 'Too bright - window';
      confidence = 0.05;
    } 
    else if (avgBright < 25) {
      surfaceType = 'dark';
      reason = 'Too dark - add light';
      confidence = 0.08;
    }
    else if (gradient > 60) {
      surfaceType = 'floor';
      reason = 'Floor - aim higher';
      confidence = 0.06;
    }
    else if (gradient < -60) {
      surfaceType = 'ceiling';
      reason = 'Ceiling - aim lower';
      confidence = 0.06;
    }
    else if (edgeDensity > 0.2) {
      surfaceType = 'textured';
      reason = 'Too textured';
      confidence = 0.15;
    }
    else if (
      uniformity > 0.65 &&
      edgeDensity < 0.15 &&
      avgSat < 0.4 &&
      avgBright > 35 &&
      avgBright < 225 &&
      Math.abs(gradient) < 50
    ) {
      isWall = true;
      surfaceType = 'wall';
      confidence = Math.min(0.96,
        uniformity * 0.35 +
        (1 - edgeDensity * 7) * 0.35 +
        (1 - avgSat) * 0.15 +
        (1 - Math.abs(gradient) / 100) * 0.15
      );
      reason = 'Wall detected';
    }
    else {
      reason = 'Move slowly';
      confidence = 0.25;
    }

    // Temporal smoothing
    this.history.push({ isWall, confidence, surfaceType });
    if (this.history.length > 10) this.history.shift();

    const recentWalls = this.history.filter(h => h.isWall).length;
    const finalIsWall = recentWalls >= 7;

    if (finalIsWall) {
      const wallFrames = this.history.filter(h => h.isWall);
      const avgConf = wallFrames.reduce((sum, h) => sum + h.confidence, 0) / wallFrames.length;
      
      return {
        isWall: true,
        confidence: avgConf,
        surfaceType: 'wall',
        reason: '✓ Wall confirmed',
        metrics: {
          uniformity: uniformity.toFixed(2),
          brightness: avgBright.toFixed(0),
          edges: edgeDensity.toFixed(3),
          frames: `${recentWalls}/10`
        }
      };
    }

    return { 
      isWall, 
      confidence, 
      surfaceType, 
      reason,
      metrics: {
        uniformity: uniformity.toFixed(2),
        brightness: avgBright.toFixed(0),
        edges: edgeDensity.toFixed(3),
        gradient: gradient.toFixed(1)
      }
    };
  }

  reset() {
    this.history = [];
  }
}

/**
 * World Anchor System
 */
class WorldAnchor {
  constructor() {
    this.worldPos = null;
    this.worldRot = null;
    this.scale = 1;
    this.initialCamMatrix = new THREE.Matrix4();
  }

  place(camera, position, rotation) {
    camera.updateMatrixWorld(true);
    this.initialCamMatrix.copy(camera.matrixWorld);
    
    this.worldPos = position.clone();
    this.worldRot = rotation.clone();
    this.scale = 1;

    console.log('🎯 Anchor placed:', position.toArray().map(v => v.toFixed(3)));
  }

  getTransform(camera) {
    if (!this.worldPos) return null;

    camera.updateMatrixWorld(true);
    
    const camDelta = new THREE.Matrix4()
      .copy(camera.matrixWorld)
      .multiply(this.initialCamMatrix.clone().invert());

    const inverseCam = camDelta.clone().invert();
    const fixedPos = this.worldPos.clone().applyMatrix4(inverseCam);

    return {
      position: fixedPos,
      rotation: this.worldRot.clone(),
      scale: this.scale
    };
  }

  update(updates) {
    if (updates.position) this.worldPos.copy(updates.position);
    if (updates.rotation) this.worldRot.copy(updates.rotation);
    if (updates.scale !== undefined) this.scale = updates.scale;
  }

  reset() {
    this.worldPos = null;
    this.worldRot = null;
    this.scale = 1;
    this.initialCamMatrix.identity();
  }
}

/**
 * Gesture Handler
 */
class GestureHandler {
  constructor(onChange) {
    this.onChange = onChange;
    this.state = null;
    this.base = null;
  }

  start(touches, current) {
    this.base = {
      position: current.position.clone(),
      rotation: current.rotation.clone(),
      scale: current.scale
    };

    if (touches.length === 1) {
      this.state = { type: 'drag', x: touches[0].clientX, y: touches[0].clientY };
    } else if (touches.length === 2) {
      const dx = touches[1].clientX - touches[0].clientX;
      const dy = touches[1].clientY - touches[0].clientY;
      this.state = {
        type: 'pinch',
        distance: Math.sqrt(dx * dx + dy * dy),
        angle: Math.atan2(dy, dx)
      };
    }
  }

  move(touches, camera) {
    if (!this.state || !this.base) return;

    if (this.state.type === 'drag' && touches.length === 1) {
      const dx = (touches[0].clientX - this.state.x) * 0.003;
      const dy = -(touches[0].clientY - this.state.y) * 0.003;

      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
      const up = new THREE.Vector3(0, 1, 0);

      const newPos = this.base.position.clone()
        .add(right.multiplyScalar(dx))
        .add(up.multiplyScalar(dy));

      this.onChange({ position: newPos, rotation: this.base.rotation, scale: this.base.scale });
    }
    else if (this.state.type === 'pinch' && touches.length === 2) {
      const dx = touches[1].clientX - touches[0].clientX;
      const dy = touches[1].clientY - touches[0].clientY;
      const distance = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);

      const scaleRatio = distance / this.state.distance;
      const newScale = Math.max(0.3, Math.min(4, this.base.scale * scaleRatio));

      const angleDelta = angle - this.state.angle;
      const rotQuat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), angleDelta);
      const newRot = this.base.rotation.clone().multiply(rotQuat);

      this.onChange({ position: this.base.position, rotation: newRot, scale: newScale });
    }
  }

  end() {
    this.state = null;
    this.base = null;
  }
}

/**
 * Components
 */
function Reticle({ position, isGood, visible }) {
  const ref = useRef();
  
  useFrame(({ clock }) => {
    if (ref.current && visible) {
      ref.current.rotation.z = clock.elapsedTime * 0.6;
    }
  });

  if (!visible) return null;

  const color = isGood ? '#00ff00' : '#ff4444';
  
  return (
    <group position={position} ref={ref}>
      <mesh renderOrder={1000}>
        <circleGeometry args={[0.02, 32]} />
        <meshBasicMaterial color={color} transparent opacity={1} depthTest={false} />
      </mesh>
      <mesh renderOrder={999}>
        <ringGeometry args={[0.08, 0.09, 32]} />
        <meshBasicMaterial color={color} transparent opacity={0.9} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      {isGood && [0, 90, 180, 270].map((a, i) => (
        <group key={i} rotation={[0, 0, (a * Math.PI) / 180]}>
          <mesh position={[0.15, 0, 0]} renderOrder={998}>
            <planeGeometry args={[0.05, 0.01]} />
            <meshBasicMaterial color={color} transparent opacity={0.95} depthTest={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function AnchoredModel({ url, anchor, isPlaced, gestureTransform }) {
  const ref = useRef();
  const gltf = useGLTF(url);
  const [scale, setScale] = useState(1);
  const { camera } = useThree();

  useEffect(() => {
    if (gltf?.scene) {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      setScale(0.5 / Math.max(size.x, size.y, size.z));
    }
  }, [gltf]);

  useFrame(() => {
    if (!ref.current || !isPlaced) return;

    const transform = gestureTransform || anchor?.getTransform(camera);
    if (!transform) return;

    ref.current.position.copy(transform.position);
    ref.current.quaternion.copy(transform.rotation);
    ref.current.scale.setScalar(transform.scale * scale);
  });

  if (!gltf?.scene) return null;

  const scene = gltf.scene.clone(true);
  scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) child.material.side = THREE.DoubleSide;
    }
  });

  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  scene.position.sub(center);

  return <primitive ref={ref} object={scene} />;
}

function PlacementSystem({ onHit, active }) {
  const { camera, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const planes = useRef([]);

  useEffect(() => {
    const depths = [0.8, 1.2, 1.6, 2.0, 2.5, 3.0, 3.5];
    const newPlanes = depths.map(d => {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(12, 12),
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
      );
      plane.position.set(0, 0, -d);
      plane.userData.depth = d;
      scene.add(plane);
      return plane;
    });
    
    planes.current = newPlanes;
    return () => newPlanes.forEach(p => scene.remove(p));
  }, [scene]);

  useFrame(() => {
    if (!active) return;

    raycaster.current.setFromCamera(new THREE.Vector2(0, 0), camera);
    const intersects = raycaster.current.intersectObjects(planes.current);

    if (intersects.length > 0) {
      const hit = intersects[0];
      const normal = new THREE.Vector3(0, 0, 1).applyQuaternion(camera.quaternion);
      
      onHit({ point: hit.point, normal, distance: hit.object.userData.depth });
    }
  });

  return null;
}

function ARScene({
  modelUrl, anchor, detector, onPlace, isPlaced,
  scanning, onAnalysis, gestureTransform, gestureHandler
}) {
  const { camera, gl } = useThree();
  const [hitData, setHitData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const frame = useRef(0);

  useFrame(() => {
    if (scanning && detector) {
      frame.current++;
      if (frame.current % 3 === 0) {
        const video = document.querySelector('.ar-video');
        detector.analyzeForWall(video).then(result => {
          setAnalysis(result);
          onAnalysis(result);
        });
      }
    }
  });

  const handleTouch = useCallback((e) => {
    e.preventDefault();
    
    if (e.type === 'touchstart') {
      if (!isPlaced && analysis?.isWall && analysis?.confidence > 0.75 && hitData) {
        const rotation = new THREE.Quaternion();
        rotation.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hitData.normal);
        onPlace(hitData.point, rotation);
      } else if (isPlaced) {
        const transform = gestureTransform || anchor.getTransform(camera);
        if (transform) gestureHandler.start(e.touches, transform);
      }
    } else if (e.type === 'touchmove' && isPlaced) {
      gestureHandler.move(e.touches, camera);
    } else if (e.type === 'touchend') {
      gestureHandler.end();
    }
  }, [isPlaced, analysis, hitData, onPlace, gestureTransform, anchor, camera, gestureHandler]);

  useEffect(() => {
    const canvas = gl.domElement;
    ['touchstart', 'touchmove', 'touchend'].forEach(event => {
      canvas.addEventListener(event, handleTouch, { passive: false });
    });
    
    return () => {
      ['touchstart', 'touchmove', 'touchend'].forEach(event => {
        canvas.removeEventListener(event, handleTouch);
      });
    };
  }, [gl, handleTouch]);

  const isGood = analysis?.isWall && analysis?.confidence > 0.75;

  return (
    <>
      <PlacementSystem onHit={setHitData} active={scanning} />
      <Reticle 
        position={hitData?.point || new THREE.Vector3(0, 0, -2)}
        isGood={isGood}
        visible={scanning && hitData}
      />
      {modelUrl && isPlaced && (
        <Suspense fallback={null}>
          <AnchoredModel 
            url={modelUrl}
            anchor={anchor}
            isPlaced={isPlaced}
            gestureTransform={gestureTransform}
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
  const anchorRef = useRef(null);
  const detectorRef = useRef(null);
  const gestureRef = useRef(null);
  const sessionStart = useRef(Date.now());
  const screenshots = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('init');
  const [placed, setPlaced] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [gestureTransform, setGestureTransform] = useState(null);

  const { currentModel, modelType } = useARStore();

  useEffect(() => {
    anchorRef.current = new WorldAnchor();
    detectorRef.current = new PureJSWallDetector();
    gestureRef.current = new GestureHandler((t) => {
      setGestureTransform(t);
      anchorRef.current?.update(t);
    });
    
    console.log('✅ Pure JS CV Detector initialized');
  }, []);

  const startCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: false
      });

      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      
      setReady(true);
      setTimeout(() => setPhase('scan'), 1000);
      
      analytics.trackARSessionStarted({ url: currentModel, type: modelType });
    } catch (err) {
      setError(err.message);
    }
  }, [currentModel, modelType]);

  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
  }, []);

  useEffect(() => {
    const start = sessionStart.current;
    const shots = screenshots.current;
    
    startCamera();
    
    return () => {
      stopCamera();
      analytics.trackARSessionEnded({
        duration: Date.now() - start,
        screenshots: shots
      });
    };
  }, [startCamera, stopCamera]);

  const handlePlace = useCallback((position, rotation) => {
    const canvas = canvasRef.current?.querySelector('canvas');
    const camera = canvas?.__threeCamera;
    if (!camera) return;

    anchorRef.current.place(camera, position, rotation);
    setGestureTransform({ position: position.clone(), rotation: rotation.clone(), scale: 1 });
    setPlaced(true);
    setPhase('placed');
    
    analytics.trackARPlacement({ confidence: analysis?.confidence });
  }, [analysis]);

  const handleReset = useCallback(() => {
    setPlaced(false);
    setPhase('scan');
    setGestureTransform(null);
    anchorRef.current?.reset();
    detectorRef.current?.reset();
  }, []);

  const handleScreenshot = useCallback(() => {
    const canvas = document.createElement('canvas');
    const video = videoRef.current;
    const threeCanvas = canvasRef.current?.querySelector('canvas');

    if (!video || !threeCanvas) return;

    canvas.width = video.videoWidth || 1920;
    canvas.height = video.videoHeight || 1080;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    ctx.drawImage(threeCanvas, 0, 0, canvas.width, canvas.height);

    canvas.toBlob((blob) => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `ar-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      screenshots.current++;
    }, 'image/png');
  }, []);

  const isGood = analysis?.isWall && analysis?.confidence > 0.75;

  return (
    <div className="ar-viewer-advanced">
      <video 
        ref={videoRef} 
        autoPlay 
        playsInline 
        muted 
        className="ar-video" 
        style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          zIndex: 1
        }}
      />

      {ready && (
        <div ref={canvasRef} className="ar-canvas-layer" style={{
          position: 'fixed',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: 2
        }}>
          <Canvas
            gl={{ alpha: true, antialias: true, preserveDrawingBuffer: true }}
            style={{ background: 'transparent' }}
            onCreated={({ camera }) => {
              const c = canvasRef.current?.querySelector('canvas');
              if (c) c.__threeCamera = camera;
            }}
          >
            <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={70} />
            <ambientLight intensity={0.7} />
            <directionalLight position={[5, 5, 5]} intensity={1.5} castShadow />
            <Environment preset="city" />
            
            <ARScene
              modelUrl={currentModel}
              anchor={anchorRef.current}
              detector={detectorRef.current}
              onPlace={handlePlace}
              isPlaced={placed}
              scanning={phase === 'scan'}
              onAnalysis={setAnalysis}
              gestureTransform={gestureTransform}
              gestureHandler={gestureRef.current}
            />
          </Canvas>
        </div>
      )}

      {!ready && !error && (
        <div className="ar-loading-screen">
          <div className="loading-ring"></div>
          <h3>Starting AR</h3>
          <p>Initializing Pure JS CV...</p>
        </div>
      )}

      {error && (
        <div className="ar-error-screen">
          <AlertTriangle size={48} color="#ff3333" />
          <h3>Camera Error</h3>
          <p>{error}</p>
          <button onClick={startCamera} className="btn-retry">
            <RefreshCw size={20} /> Retry
          </button>
        </div>
      )}

      {ready && (
        <>
          <header className="ar-header">
            <button className="ar-btn-close" onClick={onClose}>
              <X size={22} />
            </button>
            
            <div className="ar-status-pill">
              {phase === 'scan' && (
                <>
                  <Zap size={18} color={isGood ? "#00ff00" : "#888"} />
                  <span>{isGood ? 'TAP TO PLACE' : analysis?.reason || 'Scanning...'}</span>
                </>
              )}
              {phase === 'placed' && (
                <>
                  <CheckCircle size={18} color="#00ff00" />
                  <span>Placed ✓</span>
                </>
              )}
            </div>
          </header>

          {phase === 'scan' && (
            <div className={`ar-placement-guide ${!isGood ? 'warning' : 'success'}`}>
              {isGood ? (
                <>
                  <CheckCircle size={48} color="#00ff00" />
                  <h3>Wall Found!</h3>
                  <p>Tap green target to place</p>
                  <small>Confidence: {(analysis.confidence * 100).toFixed(0)}%</small>
                </>
              ) : (
                <>
                  <AlertTriangle size={48} color="#ff3333" />
                  <h3>{analysis?.surfaceType?.toUpperCase() || 'SCANNING'}</h3>
                  <p>{analysis?.reason || 'Point at plain wall'}</p>
                  {analysis?.metrics && (
                    <small style={{opacity: 0.7, fontSize: '11px'}}>
                      Bright: {analysis.metrics.brightness} | Edges: {analysis.metrics.edges} | Uni: {analysis.metrics.uniformity}
                    </small>
                  )}
                </>
              )}
            </div>
          )}

          {placed && (
            <>
              <div className="ar-instructions">
                <p>✋ Drag • 🤏 Pinch • 🔄 Rotate</p>
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
