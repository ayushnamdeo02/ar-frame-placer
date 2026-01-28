/**
 * useModelLoader Hook
 * Custom hook for loading and managing 3D models
 */

import { useState, useEffect, useCallback } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader';
import { ERROR_MESSAGES } from '../utils/constants';
import { isValidGLBUrl } from '../utils/helpers';

export const useModelLoader = () => {
  const [model, setModel] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState(null);

  /**
   * Load 3D model from URL
   */
  const loadModel = useCallback(async (url) => {
    if (!url) {
      setError('No URL provided');
      return null;
    }

    if (!isValidGLBUrl(url)) {
      setError(ERROR_MESSAGES.INVALID_URL);
      return null;
    }

    setIsLoading(true);
    setError(null);
    setProgress(0);

    try {
      const loader = new GLTFLoader();
      
      // Setup Draco decoder for compressed models
      const dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath('https://www.gstatic.com/draco/versioned/decoders/1.5.6/');
      dracoLoader.setDecoderConfig({ type: 'js' });
      loader.setDRACOLoader(dracoLoader);

      // Load the model
      const gltf = await new Promise((resolve, reject) => {
        loader.load(
          url,
          (gltf) => resolve(gltf),
          (progressEvent) => {
            if (progressEvent.lengthComputable) {
              const percentComplete = (progressEvent.loaded / progressEvent.total) * 100;
              setProgress(Math.round(percentComplete));
            }
          },
          (error) => reject(error)
        );
      });

      // Process the loaded model
      const loadedModel = gltf.scene;
      
      // Center the model
      const box = new THREE.Box3().setFromObject(loadedModel);
      const center = box.getCenter(new THREE.Vector3());
      loadedModel.position.sub(center);

      // Normalize scale
      const size = box.getSize(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 2 / maxDim;
      loadedModel.scale.setScalar(scale);

      // Enable shadows
      loadedModel.traverse((child) => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
          
          // Ensure materials render properly
          if (child.material) {
            child.material.side = THREE.DoubleSide;
          }
        }
      });

      setModel(loadedModel);
      setIsLoading(false);
      setProgress(100);
      
      return loadedModel;
    } catch (err) {
      console.error('Model loading error:', err);
      setError(ERROR_MESSAGES.MODEL_LOAD_FAILED);
      setIsLoading(false);
      setProgress(0);
      return null;
    }
  }, []);

  /**
   * Load model from file
   */
  const loadFromFile = useCallback(async (file) => {
    if (!file) {
      setError('No file provided');
      return null;
    }

    setIsLoading(true);
    setError(null);
    setProgress(0);

    try {
      // Create object URL from file
      const objectUrl = URL.createObjectURL(file);
      
      // Load using the URL
      const loadedModel = await loadModel(objectUrl);
      
      // Clean up object URL after loading
      URL.revokeObjectURL(objectUrl);
      
      return loadedModel;
    } catch (err) {
      console.error('File loading error:', err);
      setError('Failed to load model from file');
      setIsLoading(false);
      return null;
    }
  }, [loadModel]);

  /**
   * Clear loaded model
   */
  const clearModel = useCallback(() => {
    if (model) {
      // Dispose of geometries and materials
      model.traverse((child) => {
        if (child.isMesh) {
          if (child.geometry) {
            child.geometry.dispose();
          }
          if (child.material) {
            if (Array.isArray(child.material)) {
              child.material.forEach(material => material.dispose());
            } else {
              child.material.dispose();
            }
          }
        }
      });
    }
    
    setModel(null);
    setProgress(0);
    setError(null);
  }, [model]);

  /**
   * Get model info
   */
  const getModelInfo = useCallback(() => {
    if (!model) return null;

    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    let triangleCount = 0;
    let materialCount = 0;
    const materials = new Set();

    model.traverse((child) => {
      if (child.isMesh) {
        if (child.geometry) {
          const positions = child.geometry.attributes.position;
          if (positions) {
            triangleCount += positions.count / 3;
          }
        }
        if (child.material) {
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach(mat => materials.add(mat));
        }
      }
    });

    materialCount = materials.size;

    return {
      size: {
        x: size.x.toFixed(2),
        y: size.y.toFixed(2),
        z: size.z.toFixed(2),
      },
      center: {
        x: center.x.toFixed(2),
        y: center.y.toFixed(2),
        z: center.z.toFixed(2),
      },
      triangles: Math.round(triangleCount),
      materials: materialCount,
    };
  }, [model]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearModel();
    };
  }, [clearModel]);

  return {
    model,
    isLoading,
    progress,
    error,
    loadModel,
    loadFromFile,
    clearModel,
    getModelInfo,
  };
};

export default useModelLoader;