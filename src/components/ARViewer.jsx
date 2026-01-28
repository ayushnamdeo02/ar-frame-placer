/* eslint-disable no-unused-vars */
import React, { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { Canvas, useFrame, useThree, extend } from '@react-three/fiber';
import { Environment, useGLTF, PerspectiveCamera } from '@react-three/drei';
import * as THREE from 'three';
import { 
  X, Camera, RotateCcw, RefreshCw, Maximize2,
  AlertTriangle, CheckCircle, Zap, Crosshair, Move
} from 'lucide-react';

import useARStore from '../store/useARStore';
import analytics from '../services/analytics';

/**
 * ============================================================================
 * ADVANCED WALL DETECTION - IMPROVED ALGORITHM
 * ============================================================================
 */
class AdvancedWallDetector {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.history = [];
    this.debugMode = true;
  }

  async analyzeFrame(video) {
    if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) {
      return { 
        isWall: false, 
        confidence: 0, 
        reason: 'Initializing camera...', 
        surfaceType: 'unknown' 
      };
    }

    // Use higher resolution for better accuracy
    this.canvas.width = 480;
    this.canvas.height = 360;
    this.ctx.drawImage(video, 0, 0, this.canvas.width, this.canvas.height);
    
    const imageData = this.ctx.getImageData(0, 0, this.canvas.width, this.canvas.height);
    const data = imageData.data;
    const width = this.canvas.width;
    const height = this.canvas.height;

    // Multi-region analysis for better accuracy
    const regions = this.analyzeRegions(data, width, height);
    const edges = this.detectEdges(data, width, height);
    const orientation = this.detectOrientation(data, width, height);
    const texture = this.analyzeTexture(data, width, height);
    const depth = this.estimateDepth(data, width, height);

    // Decision engine
    const result = this.evaluateWallConfidence(regions, edges, orientation, texture, depth);

    // Temporal filtering
    this.history.push(result);
    if (this.history.length > 12) this.history.shift();

    const smoothed = this.temporalSmoothing();

    if (this.debugMode) {
      console.log('🔍 Wall Detection:', {
        surface: smoothed.surfaceType,
        conf: (smoothed.confidence * 100).toFixed(0) + '%',
        reason: smoothed.reason,
        frames: this.history.filter(h => h.isWall).length + '/12'
      });
    }

    return smoothed;
  }

  analyzeRegions(data, width, height) {
    const regions = {
      center: this.analyzeRegion(data, width, height, 0.3, 0.7, 0.3, 0.7),
      top: this.analyzeRegion(data, width, height, 0.2, 0.8, 0.1, 0.3),
      bottom: this.analyzeRegion(data, width, height, 0.2, 0.8, 0.7, 0.9),
      left: this.analyzeRegion(data, width, height, 0.1, 0.3, 0.3, 0.7),
      right: this.analyzeRegion(data, width, height, 0.7, 0.9, 0.3, 0.7)
    };

    return regions;
  }

  analyzeRegion(data, width, height, x1, x2, y1, y2) {
    const startX = Math.floor(width * x1);
    const endX = Math.floor(width * x2);
    const startY = Math.floor(height * y1);
    const endY = Math.floor(height * y2);

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

    // Calculate variance (uniformity)
    let variance = 0;
    values.forEach(v => variance += Math.pow(v - avgBright, 2));
    variance = Math.sqrt(variance / count);
    const uniformity = Math.max(0, 1 - variance / 80);

    return { avgBright, avgSat, uniformity, variance };
  }

  detectEdges(data, width, height) {
    let strongEdges = 0, weakEdges = 0, totalPixels = 0;

    for (let y = 2; y < height - 2; y++) {
      for (let x = 2; x < width - 2; x++) {
        const idx = (y * width + x) * 4;
        
        // Sobel operator
        const gx = 
          -data[((y-1) * width + (x-1)) * 4] + data[((y-1) * width + (x+1)) * 4] +
          -2 * data[(y * width + (x-1)) * 4] + 2 * data[(y * width + (x+1)) * 4] +
          -data[((y+1) * width + (x-1)) * 4] + data[((y+1) * width + (x+1)) * 4];
        
        const gy = 
          -data[((y-1) * width + (x-1)) * 4] - 2 * data[((y-1) * width + x) * 4] - data[((y-1) * width + (x+1)) * 4] +
          data[((y+1) * width + (x-1)) * 4] + 2 * data[((y+1) * width + x) * 4] + data[((y+1) * width + (x+1)) * 4];
        
        const magnitude = Math.sqrt(gx * gx + gy * gy);
        
        if (magnitude > 80) strongEdges++;
        else if (magnitude > 40) weakEdges++;
        totalPixels++;
      }
    }

    return {
      strongDensity: strongEdges / totalPixels,
      weakDensity: weakEdges / totalPixels,
      totalDensity: (strongEdges + weakEdges) / totalPixels
    };
  }

  detectOrientation(data, width, height) {
    // Sample multiple horizontal strips
    const strips = 8;
    const stripBrightness = [];
    
    for (let s = 0; s < strips; s++) {
      const y = Math.floor((height / strips) * s + height / (strips * 2));
      let brightness = 0, count = 0;
      
      for (let x = Math.floor(width * 0.25); x < Math.floor(width * 0.75); x++) {
        const idx = (y * width + x) * 4;
        brightness += (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        count++;
      }
      
      stripBrightness.push(brightness / count);
    }

    const topAvg = (stripBrightness[0] + stripBrightness[1] + stripBrightness[2]) / 3;
    const bottomAvg = (stripBrightness[5] + stripBrightness[6] + stripBrightness[7]) / 3;
    const gradient = bottomAvg - topAvg;

    let orientation = 'wall';
    if (gradient > 45) orientation = 'floor';
    else if (gradient < -45) orientation = 'ceiling';

    return { orientation, gradient, stripBrightness };
  }

  analyzeTexture(data, width, height) {
    const startX = Math.floor(width * 0.3);
    const endX = Math.floor(width * 0.7);
    const startY = Math.floor(height * 0.3);
    const endY = Math.floor(height * 0.7);

    let textureSum = 0, count = 0;

    for (let y = startY + 1; y < endY - 1; y++) {
      for (let x = startX + 1; x < endX - 1; x++) {
        const idx = (y * width + x) * 4;
        const center = (data[idx] + data[idx + 1] + data[idx + 2]) / 3;
        
        // Calculate Laplacian (texture measure)
        const top = (data[((y-1) * width + x) * 4] + data[((y-1) * width + x) * 4 + 1] + data[((y-1) * width + x) * 4 + 2]) / 3;
        const bottom = (data[((y+1) * width + x) * 4] + data[((y+1) * width + x) * 4 + 1] + data[((y+1) * width + x) * 4 + 2]) / 3;
        const left = (data[(y * width + (x-1)) * 4] + data[(y * width + (x-1)) * 4 + 1] + data[(y * width + (x-1)) * 4 + 2]) / 3;
        const right = (data[(y * width + (x+1)) * 4] + data[(y * width + (x+1)) * 4 + 1] + data[(y * width + (x+1)) * 4 + 2]) / 3;
        
        const laplacian = Math.abs(4 * center - top - bottom - left - right);
        textureSum += laplacian;
        count++;
      }
    }

    const avgTexture = textureSum / count;
    const textureScore = Math.min(avgTexture / 30, 1);

    return { avgTexture, textureScore };
  }

  estimateDepth(data, width, height) {
    const center = this.analyzeRegion(data, width, height, 0.4, 0.6, 0.4, 0.6);
    
    // Depth heuristic: bright + low saturation = far (wall)
    const depthScore = (center.avgBright / 255) * 0.6 + (1 - center.avgSat) * 0.4;
    
    return { depthScore, brightness: center.avgBright, saturation: center.avgSat };
  }

  evaluateWallConfidence(regions, edges, orientation, texture, depth) {
    let isWall = false;
    let confidence = 0;
    let reason = '';
    let surfaceType = 'unknown';

    const bright = regions.center.avgBright;
    const uniformity = regions.center.uniformity;
    const edgeDensity = edges.totalDensity;
    const texScore = texture.textureScore;
    const grad = orientation.gradient;

    // Rule-based classification
    if (bright > 240) {
      surfaceType = 'window';
      reason = '🪟 Window/Sky - too bright';
      confidence = 0.05;
    }
    else if (bright < 20) {
      surfaceType = 'dark';
      reason = '🌑 Too dark - need light';
      confidence = 0.05;
    }
    else if (grad > 50) {
      surfaceType = 'floor';
      reason = '⬇️ Floor detected - aim higher';
      confidence = 0.08;
    }
    else if (grad < -50) {
      surfaceType = 'ceiling';
      reason = '⬆️ Ceiling detected - aim lower';
      confidence = 0.08;
    }
    else if (edgeDensity > 0.25) {
      surfaceType = 'textured';
      reason = '🎨 Too textured - find plain wall';
      confidence = 0.12;
    }
    else if (texScore > 0.7) {
      surfaceType = 'pattern';
      reason = '🔲 Pattern detected - find plain area';
      confidence = 0.15;
    }
    else if (
      uniformity > 0.62 &&
      edgeDensity < 0.18 &&
      texScore < 0.6 &&
      regions.center.avgSat < 0.45 &&
      bright > 30 && bright < 235 &&
      Math.abs(grad) < 45
    ) {
      isWall = true;
      surfaceType = 'wall';
      
      // Calculate confidence score
      confidence = Math.min(0.98,
        uniformity * 0.30 +
        (1 - edgeDensity * 5.5) * 0.25 +
        (1 - texScore) * 0.20 +
        (1 - regions.center.avgSat) * 0.15 +
        (1 - Math.abs(grad) / 90) * 0.10
      );
      
      reason = '✅ Wall detected';
    }
    else {
      surfaceType = 'uncertain';
      reason = '🔄 Move camera slowly';
      confidence = 0.25;
    }

    return { isWall, confidence, surfaceType, reason };
  }

  temporalSmoothing() {
    const recentWalls = this.history.filter(h => h.isWall).length;
    const threshold = 8; // Need 8/12 frames

    if (recentWalls >= threshold) {
      const wallFrames = this.history.filter(h => h.isWall);
      const avgConf = wallFrames.reduce((sum, h) => sum + h.confidence, 0) / wallFrames.length;
      
      return {
        isWall: true,
        confidence: avgConf,
        surfaceType: 'wall',
        reason: `✓ Wall confirmed (${recentWalls}/12)`,
        stable: true
      };
    }

    // Return most recent result
    const latest = this.history[this.history.length - 1];
    return { ...latest, stable: false };
  }

  reset() {
    this.history = [];
  }
}

/**
 * ============================================================================
 * WEBXR NATIVE AR MANAGER
 * ============================================================================
 */
class WebXRManager {
  constructor() {
    this.session = null;
    this.supported = false;
    this.hitTestSource = null;
    this.referenceSpace = null;
  }

  async checkSupport() {
    if (!navigator.xr) {
      console.log('❌ WebXR not available');
      return false;
    }

    try {
      this.supported = await navigator.xr.isSessionSupported('immersive-ar');
      console.log('✅ WebXR AR support:', this.supported);
      return this.supported;
    } catch (error) {
      console.error('WebXR check failed:', error);
      return false;
    }
  }

  async startSession(gl) {
    if (!this.supported) return false;

    try {
      this.session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'light-estimation', 'anchors']
      });

      gl.xr.setSession(this.session);
      
      this.referenceSpace = await this.session.requestReferenceSpace('local');
      const viewerSpace = await this.session.requestReferenceSpace('viewer');
      this.hitTestSource = await this.session.requestHitTestSource({ space: viewerSpace });

      console.log('✅ WebXR session started');
      
      this.session.addEventListener('end', () => {
        this.cleanup();
      });

      return true;
    } catch (error) {
      console.error('WebXR session failed:', error);
      return false;
    }
  }

  getHitTestResults(frame) {
    if (!this.hitTestSource || !frame) return null;

    try {
      const hitTestResults = frame.getHitTestResults(this.hitTestSource);
      if (hitTestResults.length > 0) {
        const hit = hitTestResults[0];
        const pose = hit.getPose(this.referenceSpace);
        
        if (pose) {
          return {
            position: new THREE.Vector3().copy(pose.transform.position),
            orientation: new THREE.Quaternion().copy(pose.transform.orientation)
          };
        }
      }
    } catch (error) {
      console.error('Hit test error:', error);
    }

    return null;
  }

  cleanup() {
    this.hitTestSource = null;
    this.referenceSpace = null;
    this.session = null;
    console.log('WebXR session ended');
  }

  endSession() {
    if (this.session) {
      this.session.end();
    }
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

    console.log('🎯 Anchor placed at:', position.toArray().map(v => v.toFixed(2)));
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
 * GESTURE CONTROLS
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
      this.state = { 
        type: 'drag', 
        x: touches[0].clientX, 
        y: touches[0].clientY 
      };
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
      const rotQuat = new THREE.Quaternion().setFromAxisAngle(
        new THREE.Vector3(0, 0, 1), 
        angleDelta
      );
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
      {/* Center dot */}
      <mesh renderOrder={1000}>
        <circleGeometry args={[size, 32]} />
        <meshBasicMaterial 
          color={color} 
          transparent 
          opacity={1} 
          depthTest={false} 
        />
      </mesh>
      
      {/* Ring */}
      <mesh renderOrder={999}>
        <ringGeometry args={[0.08, 0.09, 32]} />
        <meshBasicMaterial 
          color={color} 
          transparent 
          opacity={isGood ? 1 : 0.7} 
          side={THREE.DoubleSide} 
          depthTest={false} 
        />
      </mesh>
      
      {/* Corner brackets */}
      {isGood && [0, 90, 180, 270].map((angle, i) => (
        <group key={i} rotation={[0, 0, (angle * Math.PI) / 180]}>
          <mesh position={[0.15, 0, 0]} renderOrder={998}>
            <planeGeometry args={[0.06, 0.012]} />
            <meshBasicMaterial 
              color={color} 
              transparent 
              opacity={1} 
              depthTest={false} 
            />
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

  useEffect(() => {
    if (gltf?.scene) {
      const box = new THREE.Box3().setFromObject(gltf.scene);
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      setNormalizedScale(0.6 / maxDim);
    }
  }, [gltf]);

  useFrame(() => {
    if (!ref.current || !isPlaced) return;

    const transform = gestureTransform || anchor?.getTransform(camera);
    if (!transform) return;

    ref.current.position.copy(transform.position);
    ref.current.quaternion.copy(transform.rotation);
    ref.current.scale.setScalar(transform.scale * normalizedScale);
  });

  if (!gltf?.scene) return null;

  const scene = gltf.scene.clone(true);
  
  scene.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
      if (child.material) {
        child.material.side = THREE.DoubleSide;
        child.material.needsUpdate = true;
      }
    }
  });

  // Center the model
  const box = new THREE.Box3().setFromObject(scene);
  const center = box.getCenter(new THREE.Vector3());
  scene.position.sub(center);

  return <primitive ref={ref} object={scene} />;
}

function HitTestSystem({ onHit, active, useWebXR, webxrManager }) {
  const { camera, scene, gl } = useThree();
  const raycaster = useRef(new THREE.Raycaster());
  const planes = useRef([]);

  useEffect(() => {
    if (useWebXR) return; // Use WebXR hit testing instead

    // Create virtual planes at different depths
    const depths = [0.5, 0.8, 1.2, 1.6, 2.0, 2.5, 3.0, 4.0];
    const newPlanes = depths.map(d => {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(15, 15),
        new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide })
      );
      plane.position.set(0, 0, -d);
      plane.userData.depth = d;
      scene.add(plane);
      return plane;
    });
    
    planes.current = newPlanes;
    return () => newPlanes.forEach(p => scene.remove(p));
  }, [scene, useWebXR]);

  useFrame((state, delta, frame) => {
    if (!active) return;

    if (useWebXR && webxrManager && frame) {
      // Use WebXR hit testing
      const hitResult = webxrManager.getHitTestResults(frame);
      if (hitResult) {
        onHit({
          point: hitResult.position,
          normal: new THREE.Vector3(0, 1, 0), // Up normal from floor
          distance: hitResult.position.length()
        });
      }
    } else {
      // Fallback raycasting
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
    }
  });

  return null;
}

function ARScene({
  modelUrl, anchor, detector, onPlace, isPlaced,
  scanning, onAnalysis, gestureTransform, gestureController,
  useWebXR, webxrManager
}) {
  const { camera, gl } = useThree();
  const [hitData, setHitData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const frame = useRef(0);

  useFrame(() => {
    if (scanning && detector && !useWebXR) {
      frame.current++;
      if (frame.current % 2 === 0) { // Analyze every 2 frames
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
      if (!isPlaced && analysis?.isWall && analysis?.confidence > 0.7 && hitData) {
        const rotation = new THREE.Quaternion();
        rotation.setFromUnitVectors(
          new THREE.Vector3(0, 0, 1), 
          hitData.normal
        );
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

  const isGood = useWebXR ? !!hitData : (analysis?.isWall && analysis?.confidence > 0.7);

  return (
    <>
      <HitTestSystem 
        onHit={setHitData} 
        active={scanning} 
        useWebXR={useWebXR}
        webxrManager={webxrManager}
      />
      
      <Reticle 
        position={hitData?.point || new THREE.Vector3(0, 0, -1.5)}
        isGood={isGood}
        visible={scanning && hitData}
      />
      
      {modelUrl && isPlaced && (
        <Suspense fallback={null}>
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
 * MAIN AR VIEWER COMPONENT
 * ============================================================================
 */
export default function CustomARViewer({ onClose }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const anchorRef = useRef(null);
  const detectorRef = useRef(null);
  const gestureRef = useRef(null);
  const webxrRef = useRef(null);
  const sessionStart = useRef(Date.now());
  const screenshots = useRef(0);

  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);
  const [phase, setPhase] = useState('init');
  const [placed, setPlaced] = useState(false);
  const [analysis, setAnalysis] = useState(null);
  const [gestureTransform, setGestureTransform] = useState(null);
  const [useWebXR, setUseWebXR] = useState(false);

  const { currentModel, modelType } = useARStore();

  useEffect(() => {
    anchorRef.current = new WorldAnchor();
    detectorRef.current = new AdvancedWallDetector();
    gestureRef.current = new GestureController((t) => {
      setGestureTransform(t);
      anchorRef.current?.update(t);
    });
    webxrRef.current = new WebXRManager();

    // Check WebXR support
    webxrRef.current.checkSupport().then(supported => {
      setUseWebXR(supported);
    });

    console.log('✅ AR System initialized');
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
    webxrRef.current?.endSession();
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
    setGestureTransform({ 
      position: position.clone(), 
      rotation: rotation.clone(), 
      scale: 1 
    });
    setPlaced(true);
    setPhase('placed');
    
    analytics.trackARPlacement({ 
      confidence: analysis?.confidence,
      method: useWebXR ? 'webxr' : 'cv'
    });
  }, [analysis, useWebXR]);

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

  const isGood = useWebXR ? true : (analysis?.isWall && analysis?.confidence > 0.7);

  return (
    <div className="ar-viewer-native">
      {/* Video background (hidden for WebXR) */}
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
          zIndex: 1,
          display: useWebXR ? 'none' : 'block'
        }}
      />

      {/* Three.js AR Canvas */}
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
            gl={{ 
              alpha: true, 
              antialias: true, 
              preserveDrawingBuffer: true,
              xr: { enabled: useWebXR }
            }}
            style={{ background: 'transparent' }}
            onCreated={({ camera, gl }) => {
              const c = canvasRef.current?.querySelector('canvas');
              if (c) c.__threeCamera = camera;
              
              if (useWebXR) {
                webxrRef.current.startSession(gl);
              }
            }}
          >
            <PerspectiveCamera makeDefault position={[0, 0, 0]} fov={70} />
            <ambientLight intensity={0.8} />
            <directionalLight 
              position={[5, 5, 5]} 
              intensity={1.5} 
              castShadow 
              shadow-mapSize-width={2048}
              shadow-mapSize-height={2048}
            />
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
              useWebXR={useWebXR}
              webxrManager={webxrRef.current}
            />
          </Canvas>
        </div>
      )}

      {/* Loading screen */}
      {!ready && !error && (
        <div className="ar-loading-screen">
          <div className="spinner">
            <div className="spinner-ring"></div>
            <div className="spinner-ring"></div>
            <div className="spinner-ring"></div>
          </div>
          <h3>Starting AR Experience</h3>
          <p>{useWebXR ? 'Initializing WebXR...' : 'Starting camera...'}</p>
        </div>
      )}

      {/* Error screen */}
      {error && (
        <div className="ar-error-screen">
          <AlertTriangle size={56} color="#ff3333" />
          <h3>Camera Access Required</h3>
          <p>{error}</p>
          <button onClick={startCamera} className="btn-retry">
            <RefreshCw size={20} /> Try Again
          </button>
        </div>
      )}

      {/* AR UI Overlay */}
      {ready && (
        <>
          {/* Header */}
          <header className="ar-header">
            <button className="ar-btn-close" onClick={onClose} aria-label="Close AR">
              <X size={24} />
            </button>
            
            <div className="ar-status-badge">
              {phase === 'scan' && (
                <>
                  <Crosshair size={18} color={isGood ? "#00ff00" : "#ff9500"} />
                  <span>{isGood ? 'TAP TO PLACE' : analysis?.reason || 'Finding surface...'}</span>
                </>
              )}
              {phase === 'placed' && (
                <>
                  <CheckCircle size={18} color="#00ff00" />
                  <span>Object Placed</span>
                </>
              )}
            </div>

            {useWebXR && (
              <div className="ar-badge-webxr">
                <Zap size={14} />
                <span>WebXR</span>
              </div>
            )}
          </header>

          {/* Scanning guide */}
          {phase === 'scan' && !useWebXR && (
            <div className={`ar-guide ${isGood ? 'ready' : 'scanning'}`}>
              <div className="ar-guide-icon">
                {isGood ? (
                  <CheckCircle size={64} color="#00ff00" />
                ) : (
                  <Move size={64} color="#ff9500" />
                )}
              </div>
              <h3>{isGood ? 'Perfect! 🎯' : 'Keep moving...'}</h3>
              <p className="ar-guide-text">
                {isGood 
                  ? 'Tap the green target to place your frame' 
                  : analysis?.reason || 'Move camera slowly to find a wall'}
              </p>
              {analysis?.metrics && (
                <div className="ar-metrics">
                  <span>Brightness: {analysis.metrics.brightness}</span>
                  <span>Edges: {analysis.metrics.edges}</span>
                  <span>Uniformity: {analysis.metrics.uniformity}</span>
                </div>
              )}
              {analysis?.stable && (
                <div className="ar-confidence-bar">
                  <div 
                    className="ar-confidence-fill" 
                    style={{width: `${analysis.confidence * 100}%`}}
                  />
                </div>
              )}
            </div>
          )}

          {/* Controls when placed */}
          {placed && (
            <>
              <div className="ar-instructions">
                <div className="ar-instruction-item">
                  <span>✋</span> Drag to move
                </div>
                <div className="ar-instruction-item">
                  <span>🤏</span> Pinch to scale
                </div>
                <div className="ar-instruction-item">
                  <span>🔄</span> Rotate with 2 fingers
                </div>
              </div>
              
              <div className="ar-toolbar">
                <button 
                  className="ar-tool-btn capture" 
                  onClick={handleScreenshot}
                  aria-label="Take screenshot"
                >
                  <Camera size={24} />
                  <span>Capture</span>
                </button>
                
                <button 
                  className="ar-tool-btn reset" 
                  onClick={handleReset}
                  aria-label="Reset placement"
                >
                  <RotateCcw size={24} />
                  <span>Reset</span>
                </button>
              </div>
            </>
          )}
        </>
      )}

      <style jsx>{`
        .ar-viewer-native {
          position: fixed;
          inset: 0;
          background: #000;
          z-index: 9999;
        }

        .ar-video {
          pointer-events: none;
        }

        .ar-loading-screen,
        .ar-error-screen {
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
          animation: spin 1.5s cubic-bezier(0.5, 0, 0.5, 1) infinite;
        }

        .spinner-ring:nth-child(2) {
          border-top-color: #0088ff;
          animation-delay: -0.3s;
          width: 70%;
          height: 70%;
          top: 15%;
          left: 15%;
        }

        .spinner-ring:nth-child(3) {
          border-top-color: #ff00ff;
          animation-delay: -0.6s;
          width: 40%;
          height: 40%;
          top: 30%;
          left: 30%;
        }

        @keyframes spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
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
          background: linear-gradient(180deg, rgba(0,0,0,0.6) 0%, transparent 100%);
        }

        .ar-btn-close {
          width: 44px;
          height: 44px;
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
          transition: all 0.2s;
        }

        .ar-btn-close:active {
          transform: scale(0.95);
          background: rgba(0, 0, 0, 0.9);
        }

        .ar-status-badge {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 10px 16px;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(10px);
          border-radius: 24px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          color: white;
          font-size: 14px;
          font-weight: 500;
        }

        .ar-badge-webxr {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 6px 12px;
          background: rgba(0, 255, 0, 0.2);
          border: 1px solid rgba(0, 255, 0, 0.4);
          border-radius: 16px;
          color: #00ff00;
          font-size: 12px;
          font-weight: 600;
        }

        .ar-guide {
          position: fixed;
          bottom: max(env(safe-area-inset-bottom), 40px);
          left: 50%;
          transform: translateX(-50%);
          width: calc(100% - 48px);
          max-width: 400px;
          padding: 24px;
          background: rgba(0, 0, 0, 0.85);
          backdrop-filter: blur(20px);
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          text-align: center;
          z-index: 100;
        }

        .ar-guide.ready {
          border-color: rgba(0, 255, 0, 0.3);
          background: rgba(0, 50, 0, 0.85);
        }

        .ar-guide-icon {
          margin-bottom: 16px;
          animation: float 2s ease-in-out infinite;
        }

        @keyframes float {
          0%, 100% { transform: translateY(0); }
          50% { transform: translateY(-10px); }
        }

        .ar-guide h3 {
          margin: 0 0 8px 0;
          font-size: 20px;
          font-weight: 600;
          color: white;
        }

        .ar-guide-text {
          margin: 0 0 12px 0;
          font-size: 14px;
          color: rgba(255, 255, 255, 0.8);
          line-height: 1.5;
        }

        .ar-metrics {
          display: flex;
          justify-content: space-around;
          gap: 8px;
          margin-top: 12px;
          font-size: 11px;
          color: rgba(255, 255, 255, 0.6);
        }

        .ar-confidence-bar {
          width: 100%;
          height: 4px;
          background: rgba(255, 255, 255, 0.1);
          border-radius: 2px;
          margin-top: 12px;
          overflow: hidden;
        }

        .ar-confidence-fill {
          height: 100%;
          background: linear-gradient(90deg, #00ff00, #00ff00);
          transition: width 0.3s;
        }

        .ar-instructions {
          position: fixed;
          top: max(env(safe-area-inset-top), 80px);
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 16px;
          padding: 12px 20px;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(10px);
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.1);
          z-index: 100;
        }

        .ar-instruction-item {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: white;
          white-space: nowrap;
        }

        .ar-instruction-item span {
          font-size: 16px;
        }

        .ar-toolbar {
          position: fixed;
          bottom: max(env(safe-area-inset-bottom), 40px);
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          gap: 16px;
          z-index: 100;
        }

        .ar-tool-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 6px;
          padding: 16px 24px;
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(10px);
          border: 1px solid rgba(255, 255, 255, 0.2);
          border-radius: 16px;
          color: white;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s;
        }

        .ar-tool-btn.capture {
          background: rgba(0, 255, 0, 0.2);
          border-color: rgba(0, 255, 0, 0.4);
          color: #00ff00;
        }

        .ar-tool-btn:active {
          transform: scale(0.95);
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
          transition: all 0.2s;
        }

        .btn-retry:active {
          transform: scale(0.95);
        }
      `}</style>
    </div>
  );
}
