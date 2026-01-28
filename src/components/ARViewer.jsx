/**
 * CustomARViewer Component
 * Advanced AR system with robust camera handling for iOS & Android
 */
import React, { useEffect, useRef, useState, useCallback, Suspense } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment, useGLTF, Center, PerspectiveCamera } from '@react-three/drei';
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
  RefreshCw
} from 'lucide-react';

import useARStore from '../store/useARStore';
import analytics from '../services/analytics';
import { TRANSFORM_CONFIG } from '../utils/constants';

/**
 * Model Component - Renders the 3D model in the scene
 */
function Model3D({ url }) {
  const { position, rotation, scale } = useARStore();
  const modelRef = useRef();
  
  const gltf = useGLTF(url);

  useFrame(() => {
    if (modelRef.current) {
      modelRef.current.position.set(position.x, position.y, position.z);
      modelRef.current.rotation.set(rotation.x, rotation.y, rotation.z);
      modelRef.current.scale.setScalar(scale);
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
      <primitive ref={modelRef} object={clonedScene} />
    </Center>
  );
}

/**
 * Main ARViewer Component
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

  const {
    currentModel,
    modelType,
    position,
    rotation,
    scale,
    showControls,
    showGrid,
    setPosition,
    setRotation,
    setScale,
    toggleControls,
    toggleGrid,
    resetTransform,
  } = useARStore();

  /**
   * Robust Camera Initialization with multiple fallbacks
   */
  const initCamera = useCallback(async () => {
    if (streamRef.current || initAttempts.current > 3) {
      return;
    }

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
        throw new Error('Camera requires HTTPS. Please access via https:// or localhost');
      }

      const constraintSets = [
        {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1920, max: 1920 },
            height: { ideal: 1080, max: 1080 },
            aspectRatio: { ideal: 16/9 }
          },
          audio: false
        },
        {
          video: {
            facingMode: { exact: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 }
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
        {
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        },
        {
          video: true,
          audio: false
        }
      ];

      let stream = null;
      let lastError = null;

      for (const constraints of constraintSets) {
        try {
          console.log('Attempting camera with constraints:', constraints);
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          
          if (stream) {
            console.log('Camera stream obtained successfully');
            break;
          }
        } catch (err) {
          console.warn('Camera constraint attempt failed:', err.message);
          lastError = err;
        }
      }

      if (!stream) {
        throw lastError || new Error('Failed to access camera with all constraint sets');
      }

      streamRef.current = stream;

      const video = videoRef.current;
      if (!video) {
        throw new Error('Video element not found');
      }

      video.srcObject = stream;

      await new Promise((resolve, reject) => {
        video.onloadedmetadata = () => {
          console.log('Video metadata loaded');
          resolve();
        };
        
        video.onerror = (error) => {
          console.error('Video error:', error);
          reject(new Error('Video element failed to load'));
        };

        setTimeout(() => reject(new Error('Video loading timeout')), 10000);
      });

      try {
        await video.play();
        console.log('Video playing successfully');
      } catch (playError) {
        console.error('Video play error:', playError);
        video.muted = true;
        await video.play();
      }

      setCameraStatus('ready');
      setCameraError(null);

      analytics.trackARSessionStarted({
        url: currentModel,
        type: modelType,
        cameraFacing: facingMode
      });

    } catch (error) {
      console.error('Camera initialization error:', error);
      
      let errorMessage = 'Camera access failed. ';
      
      if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') {
        errorMessage += 'Please allow camera permissions in your browser settings.';
      } else if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError') {
        errorMessage += 'No camera found on this device.';
      } else if (error.name === 'NotReadableError' || error.name === 'TrackStartError') {
        errorMessage += 'Camera is already in use by another application.';
      } else if (error.name === 'OverconstrainedError') {
        errorMessage += 'Camera does not support required features.';
      } else if (error.name === 'SecurityError') {
        errorMessage += 'Camera access requires HTTPS or localhost.';
      } else {
        errorMessage += error.message || 'Unknown error occurred.';
      }

      setCameraStatus('error');
      setCameraError(errorMessage);
    }
  }, [facingMode, currentModel, modelType]);

  /**
   * Stop camera stream
   */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
        console.log('Camera track stopped');
      });
      streamRef.current = null;
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /**
   * Switch camera (front/back)
   */
  const switchCamera = useCallback(() => {
    stopCamera();
    setFacingMode(prev => prev === 'environment' ? 'user' : 'environment');
    initAttempts.current = 0;
    setTimeout(() => initCamera(), 100);
  }, [stopCamera, initCamera]);

  /**
   * Retry camera initialization
   */
  const retryCamera = useCallback(() => {
    stopCamera();
    initAttempts.current = 0;
    setCameraError(null);
    setCameraStatus('initializing');
    setTimeout(() => initCamera(), 100);
  }, [stopCamera, initCamera]);

  /**
   * Initialize camera on mount
   */
  useEffect(() => {
    // Copy ref values to variables for cleanup
    const startTime = sessionStartTime.current;
    const screenshotCountValue = screenshotCount.current;
    const transformCountValue = transformCount.current;

    const timer = setTimeout(() => {
      initCamera();
    }, 500);

    return () => {
      clearTimeout(timer);
      stopCamera();
      
      // Use copied variables in cleanup
      const duration = Date.now() - startTime;
      analytics.trackARSessionEnded({
        duration,
        screenshots: screenshotCountValue,
        transforms: transformCountValue,
      });
    };
  }, [initCamera, stopCamera]);

  /**
   * Handle transform changes
   */
  const handleMove = useCallback((axis, direction) => {
    const step = TRANSFORM_CONFIG.MOVE_STEP;
    const newPosition = { ...position };

    switch (axis) {
      case 'x':
        newPosition.x += direction * step;
        break;
      case 'y':
        newPosition.y += direction * step;
        break;
      case 'z':
        newPosition.z += direction * step;
        break;
      default:
        break;
    }

    setPosition(newPosition);
    transformCount.current++;
  }, [position, setPosition]);

  const handleRotate = useCallback((axis, direction) => {
    const step = TRANSFORM_CONFIG.ROTATE_STEP;
    const newRotation = { ...rotation };

    switch (axis) {
      case 'x':
        newRotation.x += direction * step;
        break;
      case 'y':
        newRotation.y += direction * step;
        break;
      case 'z':
        newRotation.z += direction * step;
        break;
      default:
        break;
    }

    setRotation(newRotation);
    transformCount.current++;
  }, [rotation, setRotation]);

  const handleScale = useCallback((increase) => {
    const step = TRANSFORM_CONFIG.SCALE_STEP;
    const newScale = increase ? scale + step : scale - step;
    setScale(newScale);
    transformCount.current++;
  }, [scale, setScale]);

  /**
   * Capture screenshot
   */
  const handleScreenshot = useCallback(async () => {
    try {
      const composite = document.createElement('canvas');
      const video = videoRef.current;
      const canvas = canvasRef.current?.querySelector('canvas');

      if (!video || !canvas) {
        console.error('Video or canvas not found');
        return;
      }

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

  /**
   * Toggle fullscreen
   */
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!isFullscreen) {
        const elem = document.documentElement;
        if (elem.requestFullscreen) {
          await elem.requestFullscreen();
        } else if (elem.webkitRequestFullscreen) {
          await elem.webkitRequestFullscreen();
        } else if (elem.mozRequestFullScreen) {
          await elem.mozRequestFullScreen();
        } else if (elem.msRequestFullscreen) {
          await elem.msRequestFullscreen();
        }
        setIsFullscreen(true);
      } else {
        if (document.exitFullscreen) {
          await document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
          await document.webkitExitFullscreen();
        } else if (document.mozCancelFullScreen) {
          await document.mozCancelFullScreen();
        } else if (document.msExitFullscreen) {
          await document.msExitFullscreen();
        }
        setIsFullscreen(false);
      }
    } catch (error) {
      console.error('Fullscreen error:', error);
    }
  }, [isFullscreen]);

  /**
   * Handle close
   */
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
        <div ref={canvasRef} style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', zIndex: 2 }}>
          <Canvas
            gl={{ 
              alpha: true, 
              antialias: true,
              preserveDrawingBuffer: true,
              premultipliedAlpha: true,
            }}
            style={{ background: 'transparent' }}
          >
            <PerspectiveCamera makeDefault position={[0, 0, 5]} fov={50} />
            
            <ambientLight intensity={0.8} />
            <directionalLight 
              position={[10, 10, 5]} 
              intensity={1.5} 
              castShadow
              shadow-mapSize-width={1024}
              shadow-mapSize-height={1024}
            />
            <pointLight position={[-10, -10, -5]} intensity={0.5} />
            <hemisphereLight 
              skyColor="#ffffff" 
              groundColor="#444444" 
              intensity={0.6} 
            />
            
            <Environment preset="city" />
            
            {showGrid && (
              <gridHelper args={[10, 10]} position={[0, -1, 0]} />
            )}
            
            {currentModel && (
              <Suspense fallback={
                <mesh>
                  <boxGeometry args={[1, 1, 1]} />
                  <meshStandardMaterial color="#007AFF" wireframe />
                </mesh>
              }>
                <Model3D url={currentModel} />
              </Suspense>
            )}
            
            <OrbitControls 
              enableDamping
              dampingFactor={0.05}
              enableZoom
              enablePan
              minDistance={1}
              maxDistance={10}
            />
          </Canvas>
        </div>
      )}

      {(cameraStatus === 'initializing' || cameraStatus === 'requesting') && (
        <div className="ar-overlay loading-overlay">
          <div className="loading-spinner"></div>
          <p>{cameraStatus === 'initializing' ? 'Initializing camera...' : 'Requesting camera permissions...'}</p>
          <small style={{ marginTop: '10px', opacity: 0.7 }}>
            {window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' 
              ? '⚠️ Camera requires HTTPS or localhost'
              : 'Please allow camera access when prompted'}
          </small>
        </div>
      )}

      {cameraStatus === 'error' && (
        <div className="ar-overlay error-overlay">
          <div className="error-icon">⚠️</div>
          <h3>Camera Access Error</h3>
          <p style={{ marginBottom: '20px' }}>{cameraError}</p>
          
          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn btn-primary" onClick={retryCamera}>
              <RefreshCw size={18} /> Retry Camera
            </button>
            <button className="btn btn-secondary" onClick={handleClose}>
              <X size={18} /> Go Back
            </button>
          </div>

          <div style={{ marginTop: '20px', fontSize: '14px', opacity: 0.8, textAlign: 'left', maxWidth: '400px' }}>
            <strong>Troubleshooting:</strong>
            <ul style={{ marginTop: '10px', paddingLeft: '20px' }}>
              <li>Check browser camera permissions in Settings</li>
              <li>Ensure no other app is using the camera</li>
              <li>Try accessing via HTTPS or localhost</li>
              <li>Reload the page and try again</li>
              <li>Try a different browser (Chrome/Safari)</li>
            </ul>
          </div>
        </div>
      )}

      {cameraStatus === 'ready' && (
        <>
          <div className="ar-topbar">
            <button className="btn-icon" onClick={handleClose}>
              <X size={24} />
            </button>

            <div className="ar-info-badge">
              <span>{modelType === 'frame' ? '🖼️ Frame' : '🎨 Wallpaper'}</span>
            </div>

            <div className="ar-actions">
              <button className="btn-icon" onClick={toggleGrid} title="Toggle Grid (G)">
                <Grid size={20} />
              </button>
              
              <button className="btn-icon" onClick={switchCamera} title="Switch Camera">
                <RefreshCw size={20} />
              </button>
              
              <button className="btn-icon" onClick={toggleFullscreen}>
                {isFullscreen ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
              </button>
            </div>
          </div>

          <div className="ar-instructions">
            <p>👆 Drag to move • 🤏 Pinch to scale • 🔄 Two fingers to rotate</p>
          </div>

          {showControls && (
            <div className="ar-controls">
              <div className="controls-group movement-controls">
                <button 
                  className="control-btn"
                  onClick={() => handleMove('y', 1)}
                  title="Move Up"
                >
                  ↑
                </button>
                
                <div className="controls-row">
                  <button 
                    className="control-btn"
                    onClick={() => handleMove('x', -1)}
                    title="Move Left"
                  >
                    ←
                  </button>
                  
                  <button 
                    className="control-btn primary-btn"
                    onClick={handleScreenshot}
                    title="Capture (S)"
                  >
                    <Camera size={24} />
                  </button>
                  
                  <button 
                    className="control-btn"
                    onClick={() => handleMove('x', 1)}
                    title="Move Right"
                  >
                    →
                  </button>
                </div>
                
                <button 
                  className="control-btn"
                  onClick={() => handleMove('y', -1)}
                  title="Move Down"
                >
                  ↓
                </button>
              </div>

              <div className="controls-group action-controls">
                <button 
                  className="control-btn-small"
                  onClick={() => handleScale(false)}
                  title="Zoom Out (-)"
                >
                  <ZoomOut size={18} />
                </button>
                
                <button 
                  className="control-btn-small"
                  onClick={() => handleRotate('y', 1)}
                  title="Rotate"
                >
                  <RotateCw size={18} />
                </button>
                
                <button 
                  className="control-btn-small"
                  onClick={() => handleScale(true)}
                  title="Zoom In (+)"
                >
                  <ZoomIn size={18} />
                </button>
                
                <button 
                  className="control-btn-small"
                  onClick={resetTransform}
                  title="Reset (R)"
                >
                  <RotateCcw size={18} />
                </button>
              </div>
            </div>
          )}

          <button 
            className="btn-toggle-controls"
            onClick={toggleControls}
            title="Toggle Controls (C)"
          >
            {showControls ? 'Hide' : 'Show'} Controls
          </button>
        </>
      )}
    </div>
  );
}
