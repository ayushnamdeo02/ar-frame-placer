/**
 * Application Constants
 * Centralized configuration values
 */

// API Configuration
export const API_CONFIG = {
  BASE_URL: process.env.REACT_APP_API_BASE_URL || '',
  CDN_URL: process.env.REACT_APP_CDN_BASE_URL || '',
  TIMEOUT: 30000, // 30 seconds
};

// File Upload Configuration
export const UPLOAD_CONFIG = {
  MAX_FILE_SIZE: parseInt(process.env.REACT_APP_MAX_FILE_SIZE) || 10 * 1024 * 1024, // 10MB
  ALLOWED_EXTENSIONS: ['.glb', '.gltf'],
  ACCEPTED_MIME_TYPES: ['model/gltf-binary', 'model/gltf+json'],
};

// Model Configuration
export const MODEL_CONFIG = {
  DEFAULT_TYPE: process.env.REACT_APP_DEFAULT_MODEL_TYPE || 'frame',
  ALLOWED_DOMAINS: process.env.REACT_APP_ALLOWED_DOMAINS?.split(',') || [],
  TYPES: {
    FRAME: 'frame',
    WALLPAPER: 'wallpaper',
  },
};

// Camera Configuration
export const CAMERA_CONFIG = {
  VIDEO_CONSTRAINTS: {
    facingMode: 'environment',
    width: { ideal: 1920, max: 1920 },
    height: { ideal: 1080, max: 1080 },
  },
  FALLBACK_CONSTRAINTS: {
    facingMode: 'user',
    width: { ideal: 1280 },
    height: { ideal: 720 },
  },
};

// Transform Configuration
export const TRANSFORM_CONFIG = {
  DEFAULT_POSITION: { x: 0, y: 0, z: -2 },
  DEFAULT_ROTATION: { x: 0, y: 0, z: 0 },
  DEFAULT_SCALE: 1,
  MIN_SCALE: 0.1,
  MAX_SCALE: 5,
  MOVE_STEP: 0.1,
  ROTATE_STEP: Math.PI / 36, // 5 degrees
  SCALE_STEP: 0.1,
};

// Sample Models
export const SAMPLE_MODELS = [
  {
    id: 'classic-wood-frame',
    name: 'Classic Wood Frame',
    type: 'frame',
    thumbnail: 'https://images.unsplash.com/photo-1513519245088-0e12902e35ca?w=400&h=400&fit=crop',
    glbUrl: 'https://modelviewer.dev/shared-assets/models/NeilArmstrong.glb',
    description: 'Traditional wooden frame with natural finish',
  },
  {
    id: 'modern-metal-frame',
    name: 'Modern Metal Frame',
    type: 'frame',
    thumbnail: 'https://images.unsplash.com/photo-1582053433976-25c00369fc93?w=400&h=400&fit=crop',
    glbUrl: 'https://modelviewer.dev/shared-assets/models/Astronaut.glb',
    description: 'Sleek metallic frame with minimalist design',
  },
  {
    id: 'vintage-gold-frame',
    name: 'Vintage Gold Frame',
    type: 'frame',
    thumbnail: 'https://images.unsplash.com/photo-1561214115-f2f134cc4912?w=400&h=400&fit=crop',
    glbUrl: 'https://modelviewer.dev/shared-assets/models/glTF-Sample-Models/2.0/DamagedHelmet/glTF/DamagedHelmet.gltf',
    description: 'Ornate gold frame with vintage styling',
  },
  {
    id: 'minimalist-frame',
    name: 'Minimalist Frame',
    type: 'frame',
    thumbnail: 'https://images.unsplash.com/photo-1616628188859-7a11abb6fcc9?w=400&h=400&fit=crop',
    glbUrl: 'https://modelviewer.dev/shared-assets/models/reflective-sphere.gltf',
    description: 'Ultra-thin modern frame',
  },
  {
    id: 'floral-wallpaper',
    name: 'Floral Wallpaper',
    type: 'wallpaper',
    thumbnail: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=400&fit=crop',
    glbUrl: 'https://modelviewer.dev/shared-assets/models/MaterialsVariantsShoe.glb',
    description: 'Elegant floral pattern wallpaper',
  },
  {
    id: 'geometric-wallpaper',
    name: 'Geometric Wallpaper',
    type: 'wallpaper',
    thumbnail: 'https://images.unsplash.com/photo-1557672172-298e090bd0f1?w=400&h=400&fit=crop',
    glbUrl: 'https://modelviewer.dev/shared-assets/models/glTF-Sample-Models/2.0/Box/glTF/Box.gltf',
    description: 'Modern geometric pattern design',
  },
];

// UI Configuration
export const UI_CONFIG = {
  ANIMATION_DURATION: 300,
  TOAST_DURATION: 3000,
  DEBOUNCE_DELAY: 300,
  THROTTLE_DELAY: 100,
};

// Feature Flags
export const FEATURES = {
  ENABLE_UPLOAD: process.env.REACT_APP_ENABLE_UPLOAD !== 'false',
  ENABLE_URL_LOAD: process.env.REACT_APP_ENABLE_URL_LOAD !== 'false',
  ENABLE_ANALYTICS: process.env.REACT_APP_ENABLE_ANALYTICS === 'true',
  ENABLE_HISTORY: true,
  ENABLE_GRID: true,
};

// Routes
export const ROUTES = {
  HOME: '/',
  UPLOAD: '/upload',
  AR: '/ar',
};

// Error Messages
export const ERROR_MESSAGES = {
  CAMERA_ACCESS_DENIED: 'Camera access denied. Please enable camera permissions in your browser settings.',
  MODEL_LOAD_FAILED: 'Failed to load 3D model. Please check the file URL and try again.',
  FILE_TOO_LARGE: `File size exceeds maximum allowed size of ${UPLOAD_CONFIG.MAX_FILE_SIZE / 1024 / 1024}MB.`,
  INVALID_FILE_TYPE: 'Invalid file type. Please upload a .glb or .gltf file.',
  INVALID_URL: 'Invalid URL. Please enter a valid URL to a .glb file.',
  NETWORK_ERROR: 'Network error. Please check your internet connection.',
  WEBGL_NOT_SUPPORTED: 'WebGL is not supported on this device.',
  AR_NOT_SUPPORTED: 'AR is not supported on this device.',
};

// Success Messages
export const SUCCESS_MESSAGES = {
  MODEL_LOADED: 'Model loaded successfully!',
  SCREENSHOT_SAVED: 'Screenshot saved successfully!',
  SETTINGS_SAVED: 'Settings saved successfully!',
};

// Analytics Events
export const ANALYTICS_EVENTS = {
  PAGE_VIEW: 'page_view',
  MODEL_LOADED: 'model_loaded',
  AR_SESSION_STARTED: 'ar_session_started',
  AR_SESSION_ENDED: 'ar_session_ended',
  SCREENSHOT_CAPTURED: 'screenshot_captured',
  MODEL_UPLOADED: 'model_uploaded',
  ERROR_OCCURRED: 'error_occurred',
};

// Local Storage Keys
export const STORAGE_KEYS = {
  USER_PREFERENCES: 'ar-frame-placer-preferences',
  RECENT_MODELS: 'ar-frame-placer-recent-models',
  LAST_TRANSFORM: 'ar-frame-placer-last-transform',
};

// Keyboard Shortcuts
export const KEYBOARD_SHORTCUTS = {
  RESET: 'r',
  TOGGLE_CONTROLS: 'c',
  TOGGLE_GRID: 'g',
  SCREENSHOT: 's',
  UNDO: 'z',
  REDO: 'y',
  CLOSE: 'Escape',
};

// Device Support Matrix
export const DEVICE_SUPPORT = {
  ios: {
    name: 'iPhone/iPad',
    camera: true,
    gestures: true,
    screenshot: true,
    status: 'Fully Supported',
  },
  android: {
    name: 'Android',
    camera: true,
    gestures: true,
    screenshot: true,
    status: 'Fully Supported',
  },
  desktop: {
    name: 'Desktop',
    camera: true,
    gestures: true,
    screenshot: true,
    status: 'Fully Supported',
  },
};

// Named constant for default export
const constants = {
  API_CONFIG,
  UPLOAD_CONFIG,
  MODEL_CONFIG,
  CAMERA_CONFIG,
  TRANSFORM_CONFIG,
  SAMPLE_MODELS,
  UI_CONFIG,
  FEATURES,
  ROUTES,
  ERROR_MESSAGES,
  SUCCESS_MESSAGES,
  ANALYTICS_EVENTS,
  STORAGE_KEYS,
  KEYBOARD_SHORTCUTS,
  DEVICE_SUPPORT,
};

export default constants;
