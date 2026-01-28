/**
 * Utility Functions
 * Common helper functions used across the application
 */

/**
 * Validates if a URL is a valid .glb file
 */
export const isValidGLBUrl = (url) => {
  try {
    const urlObj = new URL(url);
    return urlObj.pathname.toLowerCase().endsWith('.glb');
  } catch {
    return false;
  }
};

/**
 * Validates if URL domain is allowed
 */
export const isAllowedDomain = (url, allowedDomains = []) => {
  try {
    const urlObj = new URL(url);
    const hostname = urlObj.hostname;
    
    if (allowedDomains.length === 0) return true;
    
    return allowedDomains.some(domain => 
      hostname === domain || hostname.endsWith(`.${domain}`)
    );
  } catch {
    return false;
  }
};

/**
 * Formats file size in human-readable format
 */
export const formatFileSize = (bytes) => {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
};

/**
 * Detects user's device type
 */
export const getDeviceType = () => {
  const ua = navigator.userAgent;
  
  if (/iPad|iPhone|iPod/.test(ua)) {
    return 'ios';
  }
  
  if (/Android/.test(ua)) {
    return 'android';
  }
  
  if (window.innerWidth <= 768) {
    return 'mobile';
  }
  
  return 'desktop';
};

/**
 * Checks if device supports AR
 */
export const supportsAR = () => {
  return !!(
    navigator.mediaDevices &&
    navigator.mediaDevices.getUserMedia &&
    (window.WebGLRenderingContext || window.WebGL2RenderingContext)
  );
};

/**
 * Checks if device supports WebXR
 */
export const supportsWebXR = async () => {
  if ('xr' in navigator) {
    try {
      const isSupported = await navigator.xr.isSessionSupported('immersive-ar');
      return isSupported;
    } catch {
      return false;
    }
  }
  return false;
};

/**
 * Downloads a file from URL
 */
export const downloadFile = (url, filename) => {
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};

/**
 * Creates a data URL from blob
 */
export const blobToDataURL = (blob) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
};

/**
 * Debounces a function
 */
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Throttles a function
 */
export const throttle = (func, limit) => {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};

/**
 * Clamps a number between min and max
 */
export const clamp = (value, min, max) => {
  return Math.min(Math.max(value, min), max);
};

/**
 * Generates a unique ID
 */
export const generateId = () => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

/**
 * Parses query parameters from URL
 */
export const getQueryParams = () => {
  const params = new URLSearchParams(window.location.search);
  return Object.fromEntries(params.entries());
};

/**
 * Builds URL with query parameters
 */
export const buildUrl = (baseUrl, params) => {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  });
  return url.toString();
};

/**
 * Checks if running in standalone mode (PWA)
 */
export const isStandalone = () => {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  );
};

/**
 * Gets camera facing mode preference
 */
export const getCameraFacingMode = () => {
  const deviceType = getDeviceType();
  return deviceType === 'ios' || deviceType === 'android' ? 'environment' : 'user';
};

/**
 * Converts degrees to radians
 */
export const degToRad = (degrees) => {
  return degrees * (Math.PI / 180);
};

/**
 * Converts radians to degrees
 */
export const radToDeg = (radians) => {
  return radians * (180 / Math.PI);
};

/**
 * Formats timestamp to readable date
 */
export const formatDate = (timestamp) => {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Class name merger (alternative to clsx if not installed)
 */
export const cn = (...classes) => {
  return classes.filter(Boolean).join(' ');
};

/**
 * Checks if browser is Safari
 */
export const isSafari = () => {
  return /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
};

/**
 * Checks if browser is iOS Safari
 */
export const isIOSSafari = () => {
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS/.test(ua);
};

/**
 * Request fullscreen
 */
export const requestFullscreen = (element = document.documentElement) => {
  if (element.requestFullscreen) {
    return element.requestFullscreen();
  } else if (element.webkitRequestFullscreen) {
    return element.webkitRequestFullscreen();
  } else if (element.mozRequestFullScreen) {
    return element.mozRequestFullScreen();
  } else if (element.msRequestFullscreen) {
    return element.msRequestFullscreen();
  }
  return Promise.reject(new Error('Fullscreen not supported'));
};

/**
 * Exit fullscreen
 */
export const exitFullscreen = () => {
  if (document.exitFullscreen) {
    return document.exitFullscreen();
  } else if (document.webkitExitFullscreen) {
    return document.webkitExitFullscreen();
  } else if (document.mozCancelFullScreen) {
    return document.mozCancelFullScreen();
  } else if (document.msExitFullscreen) {
    return document.msExitFullscreen();
  }
  return Promise.reject(new Error('Exit fullscreen not supported'));
};