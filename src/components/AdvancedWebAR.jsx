/**
 * AdvancedWebAR Component - FIXED VERSION
 * Simplified to ensure camera is always visible
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { X, Camera, RefreshCw, Loader } from 'lucide-react';
import useARStore from '../store/useARStore';

/**
 * Computer Vision Engine
 */
class CVEngine {
  constructor() {
    this.cv = null;
    this.isReady = false;
    this.isLoading = false;
  }

  async initialize() {
    if (this.isLoading) {
      return new Promise((resolve) => {
        const checkReady = setInterval(() => {
          if (this.isReady) {
            clearInterval(checkReady);
            resolve(true);
          }
        }, 100);
      });
    }

    if (window.cv && window.cv.imread && !this.isReady) {
      this.cv = window.cv;
      this.isReady = true;
      console.log('✅ OpenCV.js already loaded');
      return true;
    }

    this.isLoading = true;

    return new Promise((resolve) => {
      const existingScript = document.querySelector('script[src*="opencv.js"]');
      if (existingScript) {
        const checkCV = setInterval(() => {
          if (window.cv && window.cv.imread) {
            clearInterval(checkCV);
            this.cv = window.cv;
            this.isReady = true;
            this.isLoading = false;
            console.log('✅ OpenCV.js loaded');
            resolve(true);
          }
        }, 100);
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://docs.opencv.org/4.8.0/opencv.js';
      script.async = true;
      
      script.onload = () => {
        const checkCV = setInterval(() => {
          if (window.cv && window.cv.imread) {
            clearInterval(checkCV);
            this.cv = window.cv;
            this.isReady = true;
            this.isLoading = false;
            console.log('✅ OpenCV.js loaded');
            resolve(true);
          }
        }, 100);
      };

      script.onerror = () => {
        console.error('Failed to load OpenCV.js');
        this.isLoading = false;
        resolve(false);
      };
      
      document.body.appendChild(script);
    });
  }

  detectPlanes(imageData, width, height) {
    if (!this.isReady || !this.cv) return [];

    const cv = this.cv;
    let src, gray, edges, hierarchy, contours;
    
    try {
      src = cv.matFromImageData(imageData);
      gray = new cv.Mat();
      edges = new cv.Mat();
      hierarchy = new cv.Mat();
      contours = new cv.MatVector();

      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
      cv.Canny(gray, edges, 50, 150);
      cv.findContours(edges, contours, hierarchy, cv.RETR_TREE, cv.CHAIN_APPROX_SIMPLE);
      
      const planes = [];
      
      for (let i = 0; i < contours.size(); i++) {
        const contour = contours.get(i);
        const area = cv.contourArea(contour);
        
        if (area < 5000 || area > 500000) continue;
        
        const epsilon = 0.02 * cv.arcLength(contour, true);
        const approx = new cv.Mat();
        cv.approxPolyDP(contour, approx, epsilon, true);
        
        if (approx.rows === 4) {
          const rect = cv.boundingRect(contour);
          const centerX = rect.x + rect.width / 2;
          const centerY = rect.y + rect.height / 2;
          const normalizedX = (centerX / width) * 2 - 1;
          const normalizedY = -(centerY / height) * 2 + 1;
          const aspectRatio = rect.width / rect.height;
          const isVertical = aspectRatio < 1.5;
          
          planes.push({
            area: area,
            center: { x: centerX, y: centerY },
            normalized: { x: normalizedX, y: normalizedY },
            rect: rect,
            isWall: isVertical,
            confidence: Math.min(area / 50000, 1) * 0.7 + (isVertical ? 0.3 : 0.1)
          });
        }
        
        approx.delete();
      }
      
      planes.sort((a, b) => b.confidence - a.confidence);
      return planes;
      
    } catch (error) {
      console.error('Plane detection error:', error);
      return [];
    } finally {
      if (src) src.delete();
      if (gray) gray.delete();
      if (edges) edges.delete();
      if (hierarchy) hierarchy.delete();
      if (contours) contours.delete();
    }
  }
}

/**
 * 3D Model Component
 */
function AnchoredModel({ url, anchor, isPlaced }) {
  const modelRef = useRef();
  const gltf = useGLTF(url);

  useFrame(() => {
    if (!modelRef.current || !isPlaced || !anchor) return;
    
    modelRef.current.position.set(
      anchor.screenPos.x,
      anchor.screenPos.y,
      anchor.depth || -2
    );
    modelRef.current.scale.setScalar(anchor.scale || 1);
  });

  if (!gltf?.scene) return null;

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

  return <primitive ref={modelRef} object={clonedScene} />;
}

/**
 * Main Component
 */
export default function AdvancedWebAR({ onClose }) {
  const videoRef = useRef(null);
  const hiddenCanvasRef = useRef(null);
  const streamRef = useRef(null);
  const cvEngineRef = useRef(null);
  const animationFrameRef = useRef(null);
  
  const [status, setStatus] = useState('initializing');
  const [cameraReady, setCameraReady] = useState(false);
  const [detectedPlanes, setDetectedPlanes] = useState([]);
  const [selectedPlane, setSelectedPlane] = useState(null);
  const [anchor, setAnchor] = useState(null);
  const [isPlaced, setIsPlaced] = useState(false);
  const [progress, setProgress] = useState(0);

  const { currentModel } = useARStore();

  // Start camera FIRST - most important
  const startCamera = useCallback(async () => {
    try {
      console.log('📹 Requesting camera...');
      
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        }
      });

      console.log('✅ Camera stream obtained');
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        
        return new Promise((resolve) => {
          videoRef.current.onloadedmetadata = () => {
            console.log('✅ Video metadata loaded:', {
              width: videoRef.current.videoWidth,
              height: videoRef.current.videoHeight
            });
            
            videoRef.current.play()
              .then(() => {
                console.log('✅ Video playing!');
                setCameraReady(true);
                resolve(true);
              })
              .catch(err => {
                console.error('❌ Play error:', err);
                resolve(false);
              });
          };
        });
      }
      
    } catch (error) {
      console.error('❌ Camera error:', error);
      throw error;
    }
  }, []);

  // Detection loop
  const startDetectionLoop = useCallback(() => {
    const detect = () => {
      if (!videoRef.current || !hiddenCanvasRef.current || isPlaced) {
        animationFrameRef.current = requestAnimationFrame(detect);
        return;
      }

      const video = videoRef.current;
      const canvas = hiddenCanvasRef.current;
      
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        try {
          const ctx = canvas.getContext('2d');
          
          if (canvas.width !== video.videoWidth) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          
          if (cvEngineRef.current?.isReady) {
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const planes = cvEngineRef.current.detectPlanes(imageData, canvas.width, canvas.height);
            
            setDetectedPlanes(planes);
            
            const bestPlane = planes.find(p => p.isWall && p.confidence > 0.5);
            if (bestPlane) {
              setSelectedPlane(bestPlane);
            }
          }
        } catch (error) {
          console.error('Detection error:', error);
        }
      }

      animationFrameRef.current = requestAnimationFrame(detect);
    };

    detect();
  }, [isPlaced]);

  // Initialize system
  useEffect(() => {
    const init = async () => {
      try {
        setStatus('loading');
        setProgress(25);
        
        // Start camera FIRST
        await startCamera();
        setProgress(50);
        
        // Initialize OpenCV
        cvEngineRef.current = new CVEngine();
        await cvEngineRef.current.initialize();
        setProgress(75);
        
        setProgress(100);
        setStatus('ready');
        
        // Start detection
        setTimeout(() => {
          startDetectionLoop();
        }, 500);
        
      } catch (error) {
        console.error('Init error:', error);
        setStatus('error');
      }
    };

    init();
    
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera, startDetectionLoop]);

  // Handle placement
  const handlePlacement = useCallback(() => {
    if (!selectedPlane) return;

    const newAnchor = {
      screenPos: {
        x: selectedPlane.normalized.x,
        y: selectedPlane.normalized.y
      },
      depth: -2,
      scale: 1,
      planeInfo: selectedPlane
    };

    setAnchor(newAnchor);
    setIsPlaced(true);
  }, [selectedPlane]);

  // Loading screen
  if (status === 'initializing' || status === 'loading') {
    return (
      <div style={styles.container}>
        <div style={styles.loadingScreen}>
          <Loader size={64} style={styles.spinner} />
          <h2 style={styles.loadingTitle}>Initializing AR</h2>
          <div style={styles.progressBar}>
            <div style={{ ...styles.progressFill, width: `${progress}%` }} />
          </div>
          <p style={styles.loadingText}>
            {progress < 40 && 'Starting camera...'}
            {progress >= 40 && progress < 80 && 'Loading CV engine...'}
            {progress >= 80 && 'Almost ready...'}
          </p>
        </div>
      </div>
    );
  }

  // Error screen
  if (status === 'error') {
    return (
      <div style={styles.container}>
        <div style={styles.loadingScreen}>
          <X size={64} color="#ff3b30" />
          <h2 style={styles.loadingTitle}>Camera Error</h2>
          <p style={styles.loadingText}>Please allow camera access and refresh</p>
          <button style={styles.btnPrimary} onClick={onClose}>
            Go Back
          </button>
        </div>
      </div>
    );
  }

  // Main AR view
  return (
    <div style={styles.container}>
      {/* Video - ALWAYS VISIBLE */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{
          ...styles.video,
          opacity: cameraReady ? 1 : 0.5,
          border: cameraReady ? 'none' : '3px solid red'
        }}
      />

      {/* Debug info */}
      {!cameraReady && (
        <div style={styles.debugInfo}>
          <p>Camera Status: {cameraReady ? 'Ready' : 'Loading...'}</p>
        </div>
      )}

      {/* Hidden canvas */}
      <canvas ref={hiddenCanvasRef} style={{ display: 'none' }} />

      {/* 3D Canvas - Semi-transparent */}
      <Canvas
        style={styles.canvas}
        gl={{ alpha: true, antialias: true }}
        camera={{ position: [0, 0, 0], fov: 70 }}
      >
        <ambientLight intensity={0.8} />
        <directionalLight position={[5, 5, 5]} intensity={1.5} castShadow />
        
        {currentModel && isPlaced && anchor && (
          <React.Suspense fallback={null}>
            <AnchoredModel
              url={currentModel}
              anchor={anchor}
              isPlaced={isPlaced}
            />
          </React.Suspense>
        )}
      </Canvas>

      {/* UI Overlay */}
      <div style={styles.ui}>
        <button style={styles.btnClose} onClick={onClose}>
          <X size={24} />
        </button>

        {!isPlaced && (
          <div style={styles.detectionStatus}>
            {selectedPlane ? (
              <>
                <div style={{ ...styles.indicator, ...styles.indicatorSuccess }} />
                <span>Wall Detected - Tap to Place</span>
              </>
            ) : (
              <>
                <div style={{ ...styles.indicator, ...styles.indicatorScanning }} />
                <span>Scanning for Walls...</span>
              </>
            )}
          </div>
        )}

        {/* Plane markers */}
        {!isPlaced && detectedPlanes.slice(0, 5).map((plane, i) => (
          <div
            key={i}
            style={{
              ...styles.planeMarker,
              left: `${(plane.normalized.x + 1) * 50}%`,
              top: `${(-plane.normalized.y + 1) * 50}%`,
              ...(plane === selectedPlane ? styles.planeMarkerSelected : {})
            }}
          />
        ))}

        {/* Place button */}
        {!isPlaced && selectedPlane && (
          <button style={styles.btnPlace} onClick={handlePlacement}>
            Tap to Place
          </button>
        )}

        {/* Reposition button */}
        {isPlaced && (
          <div style={styles.controls}>
            <button style={styles.btnControl} onClick={() => setIsPlaced(false)}>
              <RefreshCw size={20} />
            </button>
            <button style={{ ...styles.btnControl, ...styles.btnControlPrimary }}>
              <Camera size={24} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// Inline styles for guaranteed rendering
const styles = {
  container: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#000',
    zIndex: 9999,
    overflow: 'hidden'
  },
  video: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    zIndex: 1,
    backgroundColor: '#000'
  },
  canvas: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: '100%',
    height: '100%',
    zIndex: 2,
    pointerEvents: 'none'
  },
  ui: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 3,
    pointerEvents: 'none'
  },
  loadingScreen: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
    color: 'white',
    padding: '2rem',
    zIndex: 10
  },
  spinner: {
    animation: 'spin 1s linear infinite',
    marginBottom: '2rem'
  },
  loadingTitle: {
    fontSize: '1.5rem',
    marginBottom: '1rem'
  },
  progressBar: {
    width: '100%',
    maxWidth: '400px',
    height: '4px',
    backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: '2px',
    overflow: 'hidden',
    margin: '1rem 0'
  },
  progressFill: {
    height: '100%',
    backgroundColor: 'white',
    transition: 'width 0.3s'
  },
  loadingText: {
    opacity: 0.8,
    fontSize: '0.875rem'
  },
  btnClose: {
    position: 'absolute',
    top: '1rem',
    right: '1rem',
    width: '48px',
    height: '48px',
    backgroundColor: 'rgba(0,0,0,0.7)',
    border: 'none',
    borderRadius: '50%',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    pointerEvents: 'auto',
    backdropFilter: 'blur(10px)'
  },
  detectionStatus: {
    position: 'absolute',
    top: '1rem',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: '1rem 1.5rem',
    borderRadius: '24px',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    pointerEvents: 'auto',
    backdropFilter: 'blur(10px)'
  },
  indicator: {
    width: '12px',
    height: '12px',
    borderRadius: '50%'
  },
  indicatorSuccess: {
    backgroundColor: '#00ff00',
    boxShadow: '0 0 10px rgba(0,255,0,0.5)'
  },
  indicatorScanning: {
    backgroundColor: '#ff9500',
    animation: 'pulse 1.5s infinite'
  },
  planeMarker: {
    position: 'absolute',
    width: '20px',
    height: '20px',
    border: '2px solid rgba(255,255,255,0.5)',
    borderRadius: '50%',
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none'
  },
  planeMarkerSelected: {
    borderColor: '#00ff00',
    borderWidth: '3px',
    boxShadow: '0 0 20px rgba(0,255,0,0.5)'
  },
  btnPlace: {
    position: 'absolute',
    bottom: '3rem',
    left: '50%',
    transform: 'translateX(-50%)',
    padding: '1rem 2rem',
    backgroundColor: '#00ff00',
    color: '#000',
    border: 'none',
    borderRadius: '16px',
    fontSize: '1rem',
    fontWeight: 700,
    cursor: 'pointer',
    pointerEvents: 'auto',
    boxShadow: '0 4px 20px rgba(0,255,0,0.4)'
  },
  controls: {
    position: 'absolute',
    bottom: '2rem',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    gap: '1rem',
    pointerEvents: 'auto'
  },
  btnControl: {
    width: '56px',
    height: '56px',
    backgroundColor: 'rgba(0,0,0,0.7)',
    border: 'none',
    borderRadius: '50%',
    color: 'white',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    backdropFilter: 'blur(10px)'
  },
  btnControlPrimary: {
    width: '72px',
    height: '72px',
    backgroundColor: '#007AFF'
  },
  btnPrimary: {
    padding: '1rem 2rem',
    backgroundColor: 'white',
    color: '#667eea',
    border: 'none',
    borderRadius: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    marginTop: '2rem'
  },
  debugInfo: {
    position: 'absolute',
    top: '100px',
    left: '50%',
    transform: 'translateX(-50%)',
    backgroundColor: 'rgba(255,0,0,0.8)',
    color: 'white',
    padding: '1rem',
    borderRadius: '8px',
    zIndex: 100
  }
};