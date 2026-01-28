/**
 * API Service
 * Handles all API communication with backend
 */

import axios from 'axios';
import { API_CONFIG } from '../utils/constants';

// Create axios instance with default config
const apiClient = axios.create({
  baseURL: API_CONFIG.BASE_URL,
  timeout: API_CONFIG.TIMEOUT,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    // Add auth token if available
    const token = localStorage.getItem('auth_token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Response interceptor
apiClient.interceptors.response.use(
  (response) => response.data,
  (error) => {
    const errorMessage = error.response?.data?.message || error.message;
    console.error('API Error:', errorMessage);
    return Promise.reject(error);
  }
);

/**
 * API Service Methods
 */
const ApiService = {
  /**
   * Upload 3D model file
   */
  uploadModel: async (file, metadata = {}) => {
    const formData = new FormData();
    formData.append('model', file);
    formData.append('metadata', JSON.stringify(metadata));

    return apiClient.post('/api/models/upload', formData, {
      headers: {
        'Content-Type': 'multipart/form-data',
      },
      onUploadProgress: (progressEvent) => {
        const percentCompleted = Math.round(
          (progressEvent.loaded * 100) / progressEvent.total
        );
        console.log('Upload progress:', percentCompleted + '%');
      },
    });
  },

  /**
   * Get model by ID
   */
  getModel: async (modelId) => {
    return apiClient.get(`/api/models/${modelId}`);
  },

  /**
   * Get all models
   */
  getModels: async (params = {}) => {
    return apiClient.get('/api/models', { params });
  },

  /**
   * Delete model
   */
  deleteModel: async (modelId) => {
    return apiClient.delete(`/api/models/${modelId}`);
  },

  /**
   * Validate model URL
   */
  validateModelUrl: async (url) => {
    return apiClient.post('/api/models/validate', { url });
  },

  /**
   * Generate shareable AR link
   */
  generateARLink: async (modelUrl, metadata = {}) => {
    return apiClient.post('/api/ar/generate-link', {
      modelUrl,
      metadata,
    });
  },

  /**
   * Track analytics event
   */
  trackEvent: async (eventName, eventData = {}) => {
    return apiClient.post('/api/analytics/track', {
      event: eventName,
      data: eventData,
      timestamp: new Date().toISOString(),
    });
  },

  /**
   * Save user preferences
   */
  savePreferences: async (preferences) => {
    return apiClient.post('/api/user/preferences', preferences);
  },

  /**
   * Get user preferences
   */
  getPreferences: async () => {
    return apiClient.get('/api/user/preferences');
  },

  /**
   * Health check
   */
  healthCheck: async () => {
    return apiClient.get('/api/health');
  },
};

export default ApiService;