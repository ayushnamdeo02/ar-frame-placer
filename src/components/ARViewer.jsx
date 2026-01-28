/* eslint-disable no-unused-vars */
import React, { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, useGLTF, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { 
  X, Camera, RotateCcw, RefreshCw, Crosshair,
  AlertTriangle, CheckCircle, Move, Zap
} from 'lucide-react';

import useARStore from '../store/useARStore';
import analytics from '../services/analytics';

/**
 * ============================================================================
 * PLANE SURFACE DETECTOR - Works without corners
 * Detects any flat surface (wall/floor/ceiling)
 * ============================================================================
 */
class PlaneSurfaceDetector {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.history = [];
  }

  async analyzeFrame(video) {
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      return { 
        isPlane: false, 
        confidence: 0, 
        reason: 'Camera starting...', 
        surfaceType: 'unknown' 
      };
    }

    this.canvas.width = 480;
    this.canvas.height = 360;
    this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Analyze entire visible surface
    const surface = this.analyzeSurface(data, width, height);
    const texture = this.analyzeTexture(data, width, height);
    const orientation = this.detectOrientation(data, width, height);
    const lighting = this.analyzeLighting(data, width, height);

    // Evaluate if it's a usable plane
    const result = this.evaluatePlane(surface, texture, orientation, lighting);

    // Temporal smoothing
    this.history.push(result);
    if (this.history.length > 10) this.history.shift();

    return this.smoothResults();
  }

  analyzeSurface(data, width, height) {
    // Divide into 3x3 grid to analyze uniformity across entire surface
    const gridSize = 3;
    const cellWidth = Math.floor(width / gridSize);
    const cellHeight = Math.floor(height / gridSize);
    const cells = [];

    for (let gy = 0; gy < gridSize; gy++) {
      for (let gx = 0; gx < gridSize; gx++) {
        const startX = gx * cellWidth;
        const startY = gy * cellHeight;
        const endX = Math.min(startX + cellWidth, width);
        const endY = Math.min(startY + cellHeight, height);

        let brightSum = 0, satSum = 0, count = 0;
        const values = [];

        for (let y = startY; y < endY; y++) {
          for (let x = startX; x < endX; x++) {
            const idx = (y * width + x) * 4;
            const r = data[idx], g = data[idx + 1], b = data[idx + 2];
            
            const bright = (r + g + b) / 3;
            const max = Math.max(r, g, b);
            const min = Math.min(r, g, b);
            const sat = max === 0 ? 0 : (max - min) / max;
            
            brightSum += bright;
            satSum += sat;
            values.push(bright);
            count++;
          }
        }

        const avgBright = brightSum / count;
        const avgSat = satSum / count;

        // Calculate variance within cell
        let variance = 0;
        values.forEach(v => variance += Math.pow(v - avgBright, 2));
        variance = Math.sqrt(variance / count);

        cells.push({
          avgBright,
          avgSat,
          variance,
          uniformity: Math.max(0, 1 - variance / 70)
        });
      }
    }

    // Calculate overall uniformity across cells
    const avgBrightness = cells.reduce((sum, c) => sum + c.avgBright, 0) / cells.length;
    const avgSaturation = cells.reduce((sum, c) => sum + c.avgSat, 0) / cells.length;
    const avgUniformity = cells.reduce((sum, c) => sum + c.uniformity, 0) / cells.length;

    // Check brightness consistency across cells
    let brightnessVariance = 0;
    cells.forEach(c => brightnessVariance += Math.pow(c.avgBright - avgBrightness, 2));
    brightnessVariance = Math.sqrt(brightnessVariance / cells.length);
    const crossCellUniformity = Math.max(0, 1 - brightnessVariance / 60);

    return {
      avgBrightness,
      avgSaturation,
      avgUniformity,
      crossCellUniformity,
      cells
    };
  }

  analyzeTexture(data, width, height) {
    // Sample multiple regions to detect texture patterns
    let totalTexture = 0;
    let edgeCount = 0;
    let sampleCount = 0;

    // Sample 5x5 grid
    for (let sy = 0; sy < 5; sy++) {
      for (let sx = 0; sx < 5; sx++) {
        const x = Math.floor(width * (0.1 + sx * 0.16));
        const y = Math.floor(height * (0.1 + sy * 0.16));

        if (x > 0 && x < width - 1 && y > 0 && y < height - 1) {
          const idx = (y * width + x) * 4;
          const center = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
          
          // Get neighbors
          const top = (data[((y-1) * width + x) * 4] + data[((y-1) * width + x) * 4 + 1] + data[((y-1) * width + x) * 4 + 2]) / 3;
          const bottom = (data[((y+1) * width + x) * 4] + data[((y+1) * width + x) * 4 + 1] + data[((y+1) * width + x) * 4 + 2]) / 3;
          const left = (data[(y * width + (x-1)) * 4] + data[(y * width + (x-1)) * 4 + 1] + data[(y * width + (x-1)) * 4 + 2]) / 3;
          const right = (data[(y * width + (x+1)) * 4] + data[(y * width + (x+1)) * 4 + 1] + data[(y * width + (x+1)) * 4 + 2]) / 3;
          
          // Laplacian (texture measure)
          const laplacian = Math.abs(4 * center - top - bottom - left - right);
          totalTexture += laplacian;
          
          // Edge detection
          if (laplacian > 40) edgeCount++;
          sampleCount++;
        }
      }
    }

    const avgTexture = totalTexture / sampleCount;
    const edgeDensity = edgeCount / sampleCount;
    const textureSmoothness = Math.max(0, 1 - avgTexture / 35);

    return {
      avgTexture,
      edgeDensity,
      textureSmoothness
    };
  }

  detectOrientation(data, width, height) {
    // Analyze brightness gradient from top to bottom
    const strips = 6;
    const stripBrightness = [];
    
    for (let s = 0; s < strips; s++) {
      const y = Math.floor((height / strips) * s + height / (strips * 2));
      let brightness = 0, count = 0;
      
      for (let x = Math.floor(width * 0.2); x < Math.floor(width * 0.8); x++) {
        const idx = (y * width + x) * 4;
        brightness += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        count++;
      }
      
      stripBrightness.push(brightness / count);
    }

    const topAvg = (stripBrightness[0] + stripBrightness[1]) / 2;
    const bottomAvg = (stripBrightness[4] + stripBrightness[5]) / 2;
    const gradient = bottomAvg - topAvg;

    let orientation = 'wall';
    let orientationConfidence = 1;

    if (gradient > 40) {
      orientation = 'floor';
      orientationConfidence = Math.min(1, gradient / 80);
    } else if (gradient < -40) {
      orientation = 'ceiling';
      orientationConfidence = Math.min(1, Math.abs(gradient) / 80);
    } else {
      orientationConfidence = Math.max(0, 1 - Math.abs(gradient) / 40);
    }

    return { 
      orientation, 
      gradient, 
      orientationConfidence,
      stripBrightness 
    };
  }

  analyzeLighting(data, width, height) {
    // Check for overexposure, underexposure, and uniformity
    let overexposed = 0;
    let underexposed = 0;
    let wellLit = 0;
    let total = 0;

    for (let y = 0; y < height; y += 4) {
      for (let x = 0; x < width; x += 4) {
        const idx = (y * width + x) * 4;
        const bright = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        
        if (bright > 240) overexposed++;
        else if (bright < 15) underexposed++;
        else wellLit++;
        total++;
      }
    }

    const overexposureRatio = overexposed / total;
    const underexposureRatio = underexposed / total;
    const wellLitRatio = wellLit / total;

    return {
      overexposureRatio,
      underexposureRatio,
      wellLitRatio,
      isGoodLighting: wellLitRatio > 0.7
    };
  }

  evaluatePlane(surface, texture, orientation, lighting) {
    let isPlane = false;
    let confidence = 0;
    let reason = '';
    let surfaceType = 'unknown';

    // Lighting checks first
    if (lighting.overexposureRatio > 0.4) {
      surfaceType = 'overexposed';
      reason = '☀️ Too bright - move away from light';
      confidence = 0.05;
    }
    else if (lighting.underexposureRatio > 0.5) {
      surfaceType = 'underexposed';
      reason = '🌑 Too dark - need more light';
      confidence = 0.05;
    }
    // Orientation checks
    else if (orientation.orientation === 'floor' && orientation.orientationConfidence > 0.6) {
      surfaceType = 'floor';
      reason = '⬇️ Floor - aim at wall (or tap to place on floor)';
      confidence = 0.5; // Allow floor placement
      isPlane = true; // Floor is still a plane!
    }
    else if (orientation.orientation === 'ceiling' && orientation.orientationConfidence > 0.6) {
      surfaceType = 'ceiling';
      reason = '⬆️ Ceiling - aim lower';
      confidence = 0.3;
    }
    // Texture checks
    else if (texture.edgeDensity > 0.3) {
      surfaceType = 'busy';
      reason = '🎨 Too much detail - find plain surface';
      confidence = 0.15;
    }
    // Main plane detection - RELAXED REQUIREMENTS
    else if (
      surface.avgUniformity > 0.55 &&           // Relaxed from 0.62
      surface.crossCellUniformity > 0.50 &&     // Relaxed from 0.60
      texture.textureSmoothness > 0.55 &&       // Relaxed from 0.65
      surface.avgSaturation < 0.5 &&            // Relaxed from 0.45
      surface.avgBrightness > 25 &&
      surface.avgBrightness < 235 &&
      lighting.wellLitRatio > 0.6                // Relaxed from 0.7
    ) {
      isPlane = true;
      surfaceType = orientation.orientation === 'floor' ? 'floor' : 'wall';
      
      confidence = Math.min(0.98,
        surface.avgUniformity * 0.25 +
        surface.crossCellUniformity * 0.25 +
        texture.textureSmoothness * 0.20 +
        (1 - surface.avgSaturation) * 0.15 +
        lighting.wellLitRatio * 0.15
      );
      
      reason = surfaceType === 'floor' 
        ? '✅ Floor detected - tap to place'
        : '✅ Wall detected - tap to place';
    }
    else {
      surfaceType = 'uncertain';
      reason = '🔄 Keep moving slowly';
      confidence = 0.25;
    }

    return { 
      isPlane, 
      confidence, 
      surfaceType, 
      reason,
      metrics: {
        uniformity: surface.avgUniformity.toFixed(2),
        brightness: surface.avgBrightness.toFixed(0),
        texture: texture.textureSmoothness.toFixed(2),
        lighting: lighting.wellLitRatio.toFixed(2)
      }
    };
  }

  smoothResults() {
    const recentPlanes = this.history.filter(h => h.isPlane).length;
    const threshold = 7; // Need 7/10 frames

    if (recentPlanes >= threshold) {
      const planeFrames = this.history.filter(h => h.isPlane);
      const avgConf = planeFrames.reduce((sum, h) => sum + h.confidence, 0) / planeFrames.length;
      const mostCommonType = planeFrames[planeFrames.length - 1].surfaceType;
      
      return {
        isPlane: true,
        confidence: avgConf,
        surfaceType: mostCommonType,
        reason: `✓ ${mostCommonType.toUpperCase()} confirmed (${recentPlanes}/10)`,
        stable: true,
        metrics: planeFrames[planeFrames.length - 1].metrics
      };
    }

    const latest = this.history[this.history.length - 1];
    return { ...latest, stable: false };
  }

  reset() {
    this.history = [];
  }
}

/**
 * ============================================================================
 * WORLD ANCHOR SYSTEM
 * ============================================================================
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

    console.log('🎯 Anchor placed:', {
      position: position.toArray().map(v => v.toFixed(2)),
      rotation: rotation.toArray().map(v => v.toFixed(2))
    });
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
 * ============================================================================
 * GESTURE CONTROLLER
 * ============================================================================
 */
class GestureController {
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
      const dx = (touches[0].clientX - this.state.x) * 0.004;
      const dy = -(touches[0].clientY - this.state.y) * 0.004;

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
      const newScale = Math.max(0.2, Math.min(5, this.base.scale * scaleRatio));

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
 * ============================================================================
 * 3D COMPONENTS
 * ============================================================================
 */

function Reticle({ position, isGood, visible }) {
  const ref = useRef();
  
  useFrame(({ clock }) => {
    if (ref.current && visible) {
      ref.current.rotation.z = clock.elapsedTime * 0.5;
      const pulse = 0.95 + Math.sin(clock.elapsedTime * 3) * 0.05;
      ref.current.scale.setScalar(pulse);
    }
  });

  if (!visible) return null;

  const color = isGood ? '#00ff00' : '#ff9500';
  const size = isGood ? 0.025 : 0.02;
  
  return (
    <group position={position} ref={ref}>
      <mesh renderOrder={1000}>
        <circleGeometry args={[size, 32]} />
        <meshBasicMaterial color={color} transparent opacity={1} depthTest={false} />
      </mesh>
      <mesh renderOrder={999}>
        <ringGeometry args={[0.08, 0.09, 32]} />
        <meshBasicMaterial color={color} transparent opacity={isGood ? 1 : 0.7} side={THREE.DoubleSide} depthTest={false} />
      </mesh>
      {isGood && [0, 90, 180, 270].map((angle, i) => (
        <group key={i} rotation={[0, 0, (angle * Math.PI) / 180]}>
          <mesh position={[0.15, 0, 0]} renderOrder={998}>
            <planeGeometry args={[0.06, 0.012]} />
            <meshBasicMaterial color={color} transparent opacity={1} depthTest={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function Model3D({ url, anchor, isPlaced, gestureTransform }) {
  const ref = useRef();
  const gltf = useGLTF(url);
  const [normalizedScale, setNormalizedScale] = useState(1);
  const { camera } = useThree();
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    if (gltf?.scene) {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      
      const scale = 0.6 / maxDim;
      setNormalizedScale(scale);
      setIsReady(true);
      
      console.log('✅ Model loaded:', {
        size: size.toArray().map(v => v.toFixed(2)),
        scale: scale.toFixed(3)
      });
    }
  }, [gltf]);

  useFrame(() => {
    if (!ref.current || !isPlaced || !isReady) return;

    const transform = gestureTransform || anchor?.getTransform(camera);
    if (!transform) return;

    ref.current.position.copy(transform.position);
    ref.current.quaternion.copy(transform.rotation);
    ref.current.scale.setScalar(transform.scale * normalizedScale);
    ref.current.visible = true;
  });

  if (!gltf?.scene || !isReady) {
    console.log('⏳ Loading model...');
    return null;
  }

  const scene = gltf.scene.clone(true);
  
  scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      child.frustumCulled = false;
      
      if (child.material) {
        child.material.side = THREE.DoubleSide;
        child.material.transparent = false;
        child.material.opacity = 1;
        child.material.depthWrite = true;
        child.material.depthTest = true;
        child.material.needsUpdate = true;
      }
    }
  });

  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  scene.position.sub(center);

  console.log('🎨 Model ready to render');

  return (
    <group ref={ref}>
      <primitive object={scene} />
      {/* Debug marker */}
      <mesh position={[0, 0, 0]}>
        <sphereGeometry args={[0.02, 16, 16]} />
        <meshBasicMaterial color="lime" />
      </mesh>
    </group>
  );
}

function HitTestSystem({ onHit, active }) {
  const { camera, scene } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const planes = useRef([]);

  useEffect(() => {
    const depths = [0.5, 0.8, 1.0, 1.3, 1.6, 2.0, 2.5, 3.0, 4.0];
    const newPlanes = depths.map(d => {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(20, 20),
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
      
      onHit({
        point: hit.point,
        normal,
        distance: hit.object.userData.depth
      });
    }
  });

  return null;
}

function ARScene({
  modelUrl, anchor, detector, onPlace, isPlaced,
  scanning, onAnalysis, gestureTransform, gestureController
}) {
  const { camera, gl } = useThree();
  const [hitData, setHitData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const frame = useRef(0);

  useFrame(() => {
    if (scanning && detector) {
      frame.current++;
      if (frame.current % 2 === 0) {
        const video = document.querySelector('.ar-video');
        detector.analyzeFrame(video).then(result => {
          setAnalysis(result);
          onAnalysis(result);
        });
      }
    }
  });

  const handleTouch = useCallback((e) => {
    e.preventDefault();
    
    if (e.type === 'touchstart') {
      if (!isPlaced && analysis?.isPlane && analysis?.confidence > 0.45 && hitData) {
        const rotation = new THREE.Quaternion();
        rotation.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hitData.normal);
        onPlace(hitData.point, rotation);
      } else if (isPlaced) {
        const transform = gestureTransform || anchor.getTransform(camera);
        if (transform) gestureController.start(e.touches, transform);
      }
    } else if (e.type === 'touchmove' && isPlaced) {
      gestureController.move(e.touches, camera);
    } else if (e.type === 'touchend') {
      gestureController.end();
    }
  }, [isPlaced, analysis, hitData, onPlace, gestureTransform, anchor, camera, gestureController]);

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

  const isGood = analysis?.isPlane && analysis?.confidence > 0.45;

  return (
    <>
      <HitTestSystem onHit={setHitData} active={scanning} />
      
      <Reticle 
        position={hitData?.point || new THREE.Vector3(0, 0, -1.5)}
        isGood={isGood}
        visible={scanning && hitData}
      />
      
      {modelUrl && isPlaced && (
        <Suspense fallback={
          <mesh position={hitData?.point || [0, 0, -1.5]}>
            <boxGeometry args={[0.2, 0.2, 0.2]} />
            <meshStandardMaterial color="cyan" wireframe />
          </mesh>
        }>
          <Model3D 
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
 * ============================================================================
 * MAIN COMPONENT
 * ============================================================================
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
    detectorRef.current = new PlaneSurfaceDetector();
    gestureRef.current = new GestureController((t) => {
      setGestureTransform(t);
      anchorRef.current?.update(t);
    });

    console.log('✅ AR System initialized');
    console.log('📦 Model URL:', currentModel);
  }, [currentModel]);

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
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      
      setReady(true);
      setTimeout(() => setPhase('scan'), 800);
      
      analytics.trackARSessionStarted({ url: currentModel, type: modelType });
    } catch (err) {
      setError(err.message);
      console.error('Camera error:', err);
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
    if (!camera) {
      console.error('❌ Camera not found');
      return;
    }

    console.log('🎯 Placing model at:', {
      position: position.toArray().map(v => v.toFixed(2)),
      rotation: rotation.toArray().map(v => v.toFixed(2)),
      modelUrl: currentModel
    });

    anchorRef.current.place(camera, position, rotation);
    setGestureTransform({ 
      position: position.clone(), 
      rotation: rotation.clone(), 
      scale: 1 
    });
    setPlaced(true);
    setPhase('placed');
    
    analytics.trackARPlacement({ 
      confidence: analysis?.confidence,
      surfaceType: analysis?.surfaceType
    });
  }, [analysis, currentModel]);

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
      a.download = `ar-frame-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
      screenshots.current++;
    }, 'image/png');
  }, []);

  const isGood = analysis?.isPlane && analysis?.confidence > 0.45;

  return (
    <div className="ar-viewer-complete">
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
          zIndex: 2,
          pointerEvents: 'auto'
        }}>
          <Canvas
            gl={{ 
              alpha: true, 
              antialias: true, 
              preserveDrawingBuffer: true,
              powerPreference: "high-performance"
            }}
            style={{ background: 'transparent' }}
            onCreated={({ camera, gl, scene }) => {
              const c = canvasRef.current?.querySelector('canvas');
              if (c) {
                c.__threeCamera = camera;
                c.__threeScene = scene;
              }
              console.log('✅ Canvas created');
            }}
          >
            <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={70} />
            
            <ambientLight intensity={1.5} />
            <directionalLight position={[5, 5, 5]} intensity={2} castShadow />
            <directionalLight position={[-5, -5, -5]} intensity={1} />
            <hemisphereLight skyColor="#ffffff" groundColor="#888888" intensity={1} />
            
            <Environment preset="apartment" />
            
            <ARScene
              modelUrl={currentModel}
              anchor={anchorRef.current}
              detector={detectorRef.current}
              onPlace={handlePlace}
              isPlaced={placed}
              scanning={phase === 'scan'}
              onAnalysis={setAnalysis}
              gestureTransform={gestureTransform}
              gestureController={gestureRef.current}
            />
          </Canvas>
        </div>
      )}

      {!ready && !error && (
        <div className="ar-loading">
          <div className="spinner">
            <div className="spinner-ring"></div>
            <div className="spinner-ring"></div>
          </div>
          <h3>Starting AR</h3>
          <p>Initializing camera...</p>
        </div>
      )}

      {error && (
        <div className="ar-error">
          <AlertTriangle size={56} color="#ff3333" />
          <h3>Camera Required</h3>
          <p>{error}</p>
          <button onClick={startCamera} className="btn-retry">
            <RefreshCw size={20} /> Try Again
          </button>
        </div>
      )}

      {ready && (
        <>
          <header className="ar-header">
            <button className="btn-close" onClick={onClose}>
              <X size={24} />
            </button>
            
            <div className="status-badge">
              {phase === 'scan' && (
                <>
                  <Crosshair size={18} color={isGood ? "#00ff00" : "#ff9500"} />
                  <span>{isGood ? 'TAP TO PLACE' : analysis?.reason || 'Scanning...'}</span>
                </>
              )}
              {phase === 'placed' && (
                <>
                  <CheckCircle size={18} color="#00ff00" />
                  <span>Placed</span>
                </>
              )}
            </div>
          </header>

          {phase === 'scan' && (
            <div className={`guide ${isGood ? 'ready' : 'scanning'}`}>
              <div className="guide-icon">
                {isGood ? <CheckCircle size={64} color="#00ff00" /> : <Move size={64} color="#ff9500" />}
              </div>
              <h3>{isGood ? 'Perfect! 🎯' : 'Finding surface...'}</h3>
              <p>{analysis?.reason || 'Move camera to scan surface'}</p>
              {analysis?.metrics && (
                <div className="metrics">
                  <span>Uniformity: {analysis.metrics.uniformity}</span>
                  <span>Brightness: {analysis.metrics.brightness}</span>
                  <span>Texture: {analysis.metrics.texture}</span>
                </div>
              )}
              {analysis?.stable && (
                <div className="confidence-bar">
                  <div className="confidence-fill" style={{width: `${analysis.confidence * 100}%`}} />
                </div>
              )}
            </div>
          )}

          {placed && (
            <>
              <div className="instructions">
                <div><span>✋</span> Drag</div>
                <div><span>🤏</span> Pinch</div>
                <div><span>🔄</span> Rotate</div>
              </div>
              
              <div className="toolbar">
                <button className="tool-btn capture" onClick={handleScreenshot}>
                  <Camera size={24} />
                  <span>Capture</span>
                </button>
                <button className="tool-btn reset" onClick={handleReset}>
                  <RotateCcw size={24} />
                  <span>Reset</span>
                </button>
              </div>
            </>
          )}
        </>
      )}

      <style jsx>{`
        .ar-viewer-complete {
          position: fixed;
          inset: 0;
          background: #000;
          z-index: 9999;
        }

        .ar-loading, .ar-error {
          position: fixed;
          inset: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          background: #000;
          color: white;
          z-index: 10;
        }

        .spinner {
          position: relative;
          width: 80px;
          height: 80px;
          margin-bottom: 24px;
        }

        .spinner-ring {
          position: absolute;
          width: 100%;
          height: 100%;
          border: 4px solid transparent;
          border-top-color: #00ff00;
          border-radius: 50%;
          animation: spin 1.5s linear infinite;
        }

        .spinner-ring:nth-child(2) {
          border-top-color: #0088ff;
          animation-delay: -0.5s;
          width: 60%;
          height: 60%;
          top: 20%;
          left: 20%;
        }

        @keyframes spin {
          to { transform: rotate(360deg); }
        }

        .ar-header {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          padding: max(env(safe-area-inset-top), 16px) 16px 16px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          z-index: 100;
          background: linear-gradient(180deg, rgba(0,0,0,0.6), transparent);
        }

        .btn-close {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.1);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }

        .status-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(10px);
          border-radius: 24px;
          border: 1px solid rgba(255,255,255,0.1);
          color: white;
          font-size: 14px;
          font-weight: 500;
        }

        .guide {
          position: fixed;
          bottom: max(env(safe-area-inset-bottom), 40px);
          left: 50%;
          transform: translateX(-50%);
          width: calc(100% - 48px);
          max-width: 400px;
          padding: 24px;
          background: rgba(0,0,0,0.85);
          backdrop-filter: blur(20px);
          border-radius: 20px;
          border: 1px solid rgba(255,255,255,0.1);
          text-align: center;
          z-index: 100;
        }

        .guide.ready {
          border-color: rgba(0,255,0,0.3);
          background: rgba(0,50,0,0.85);
        }

        .guide-icon {
          margin-bottom: 16px;
          animation: float 2s ease-in-out infinite;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        .guide h3 {
          margin: 0 0 8px 0;
          font-size: 20px;
          font-weight: 600;
          color: white;
        }

        .guide p {
          margin: 0 0 12px 0;
          font-size: 14px;
          color: rgba(255,255,255,0.8);
        }

        .metrics {
          display: flex;
          justify-content: space-around;
          gap: 8px;
          margin-top: 12px;
          font-size: 11px;
          color: rgba(255,255,255,0.6);
        }

        .confidence-bar {
          width: 100%;
          height: 4px;
          background: rgba(255,255,255,0.1);
          border-radius: 2px;
          margin-top: 12px;
          overflow: hidden;
        }

        .confidence-fill {
          height: 100%;
          background: #00ff00;
          transition: width 0.3s;
        }

        .instructions {
          position: fixed;
          top: max(env(safe-area-inset-top), 80px);
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 16px;
          padding: 12px 20px;
          background: rgba(0,0,0,0.7);
          backdrop-filter: blur(10px);
          border-radius: 20px;
          z-index: 100;
        }

        .instructions div {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: white;
        }

        .instructions span {
          font-size: 16px;
        }

        .toolbar {
          position: fixed;
          bottom: max(env(safe-area-inset-bottom), 40px);
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 16px;
          z-index: 100;
        }

        .tool-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 16px 24px;
          background: rgba(0,0,0,0.8);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255,255,255,0.2);
          border-radius: 16px;
          color: white;
          font-size: 12px;
          cursor: pointer;
        }

        .tool-btn.capture {
          background: rgba(0,255,0,0.2);
          border-color: rgba(0,255,0,0.4);
          color: #00ff00;
        }

        .btn-retry {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 14px 28px;
          margin-top: 24px;
          background: #00ff00;
          color: #000;
          border: none;
          border-radius: 12px;
          font-size: 16px;
          font-weight: 600;
          cursor: pointer;
        }
      `}</style>
    </div>
  );
}
