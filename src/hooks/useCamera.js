/**
 * useCamera Hook
 * Custom hook for managing camera access and video stream
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { CAMERA_CONFIG, ERROR_MESSAGES } from '../utils/constants';
import { getCameraFacingMode } from '../utils/helpers';

export const useCamera = (options = {}) => {
  const [stream, setStream] = useState(null);
  const [isActive, setIsActive] = useState(false);
  const [error, setError] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [facingMode, setFacingMode] = useState(getCameraFacingMode());
  
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  /**
   * Request camera access
   */
  const startCamera = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      // Try primary constraints first
      let constraints = {
        video: {
          ...CAMERA_CONFIG.VIDEO_CONSTRAINTS,
          facingMode: options.facingMode || facingMode,
        },
        audio: false,
      };

      let mediaStream;
      
      try {
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      } catch (primaryError) {
        console.warn('Primary camera constraints failed, trying fallback...', primaryError);
        
        // Try fallback constraints
        constraints = {
          video: {
            ...CAMERA_CONFIG.FALLBACK_CONSTRAINTS,
            facingMode: options.facingMode || 'user',
          },
          audio: false,
        };
        
        mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      }

      streamRef.current = mediaStream;
      setStream(mediaStream);
      setIsActive(true);

      // Attach to video element if provided
      if (videoRef.current && mediaStream) {
        videoRef.current.srcObject = mediaStream;
      }

      setIsLoading(false);
      return mediaStream;
    } catch (err) {
      console.error('Camera access error:', err);
      
      let errorMessage = ERROR_MESSAGES.CAMERA_ACCESS_DENIED;
      
      if (err.name === 'NotAllowedError') {
        errorMessage = 'Camera access denied. Please enable camera permissions.';
      } else if (err.name === 'NotFoundError') {
        errorMessage = 'No camera found on this device.';
      } else if (err.name === 'NotReadableError') {
        errorMessage = 'Camera is already in use by another application.';
      } else if (err.name === 'OverconstrainedError') {
        errorMessage = 'Camera constraints could not be satisfied.';
      }

      setError(errorMessage);
      setIsLoading(false);
      setIsActive(false);
      return null;
    }
  }, [facingMode, options.facingMode]);

  /**
   * Stop camera
   */
  const stopCamera = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        track.stop();
      });
      streamRef.current = null;
      setStream(null);
      setIsActive(false);
    }

    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  }, []);

  /**
   * Switch camera (front/back)
   */
  const switchCamera = useCallback(async () => {
    const newFacingMode = facingMode === 'environment' ? 'user' : 'environment';
    
    stopCamera();
    setFacingMode(newFacingMode);
    
    // Restart with new facing mode
    return startCamera();
  }, [facingMode, stopCamera, startCamera]);

  /**
   * Take snapshot from video
   */
  const takeSnapshot = useCallback(() => {
    if (!videoRef.current || !isActive) {
      return null;
    }

    const video = videoRef.current;
    const canvas = document.createElement('canvas');
    
    canvas.width = video.videoWidth || video.width;
    canvas.height = video.videoHeight || video.height;
    
    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    
    return canvas.toDataURL('image/png');
  }, [isActive]);

  /**
   * Get video track settings
   */
  const getVideoSettings = useCallback(() => {
    if (!streamRef.current) return null;
    
    const videoTrack = streamRef.current.getVideoTracks()[0];
    return videoTrack ? videoTrack.getSettings() : null;
  }, []);

  /**
   * Get available cameras
   */
  const getAvailableCameras = useCallback(async () => {
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      return devices.filter(device => device.kind === 'videoinput');
    } catch (err) {
      console.error('Error enumerating devices:', err);
      return [];
    }
  }, []);

  /**
   * Check camera support
   */
  const checkSupport = useCallback(() => {
    return !!(
      navigator.mediaDevices &&
      navigator.mediaDevices.getUserMedia
    );
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Auto-start if specified
  useEffect(() => {
    if (options.autoStart) {
      startCamera();
    }
  }, [options.autoStart, startCamera]);

  return {
    stream,
    isActive,
    isLoading,
    error,
    facingMode,
    videoRef,
    startCamera,
    stopCamera,
    switchCamera,
    takeSnapshot,
    getVideoSettings,
    getAvailableCameras,
    checkSupport,
  };
};

export default useCamera;