/**
 * Analytics Service
 * Handles analytics tracking for Google Analytics, custom events, etc.
 */

import { ANALYTICS_EVENTS, FEATURES } from '../utils/constants';

class AnalyticsService {
  constructor() {
    this.enabled = FEATURES.ENABLE_ANALYTICS;
    this.queue = [];
    this.initialized = false;
  }

  /**
   * Initialize analytics
   */
  init() {
    if (!this.enabled) return;

    // Initialize Google Analytics if available
    if (typeof window.gtag === 'function') {
      this.initialized = true;
      this.flushQueue();
    }

    // Initialize other analytics providers here
  }

  /**
   * Track page view
   */
  pageView(pagePath, pageTitle) {
    if (!this.enabled) return;

    const eventData = {
      page_path: pagePath,
      page_title: pageTitle,
    };

    this.track(ANALYTICS_EVENTS.PAGE_VIEW, eventData);
  }

  /**
   * Track custom event
   */
  track(eventName, eventData = {}) {
    if (!this.enabled) return;

    const event = {
      name: eventName,
      data: {
        ...eventData,
        timestamp: new Date().toISOString(),
        user_agent: navigator.userAgent,
      },
    };

    if (!this.initialized) {
      this.queue.push(event);
      return;
    }

    this.sendEvent(event);
  }

  /**
   * Send event to analytics providers
   */
  sendEvent(event) {
    // Google Analytics
    if (typeof window.gtag === 'function') {
      window.gtag('event', event.name, event.data);
    }

    // Facebook Pixel
    if (typeof window.fbq === 'function') {
      window.fbq('trackCustom', event.name, event.data);
    }

    // Custom analytics endpoint
    this.sendToCustomEndpoint(event);

    // Console log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('Analytics Event:', event);
    }
  }

  /**
   * Send to custom analytics endpoint
   */
  async sendToCustomEndpoint(event) {
    try {
      await fetch('/api/analytics/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(event),
      });
    } catch (error) {
      console.warn('Failed to send analytics:', error);
    }
  }

  /**
   * Flush queued events
   */
  flushQueue() {
    while (this.queue.length > 0) {
      const event = this.queue.shift();
      this.sendEvent(event);
    }
  }

  /**
   * Track model loaded
   */
  trackModelLoaded(modelData) {
    this.track(ANALYTICS_EVENTS.MODEL_LOADED, {
      model_url: modelData.url,
      model_type: modelData.type,
      model_size: modelData.size,
    });
  }

  /**
   * Track AR session started
   */
  trackARSessionStarted(modelData) {
    this.track(ANALYTICS_EVENTS.AR_SESSION_STARTED, {
      model_url: modelData.url,
      model_type: modelData.type,
      device_type: this.getDeviceType(),
    });
  }

  /**
   * Track AR session ended
   */
  trackARSessionEnded(sessionData) {
    this.track(ANALYTICS_EVENTS.AR_SESSION_ENDED, {
      duration: sessionData.duration,
      screenshots_taken: sessionData.screenshots,
      transforms_applied: sessionData.transforms,
    });
  }

  /**
   * Track screenshot captured
   */
  trackScreenshotCaptured() {
    this.track(ANALYTICS_EVENTS.SCREENSHOT_CAPTURED);
  }

  /**
   * Track model uploaded
   */
  trackModelUploaded(uploadData) {
    this.track(ANALYTICS_EVENTS.MODEL_UPLOADED, {
      file_size: uploadData.size,
      file_type: uploadData.type,
      upload_method: uploadData.method,
    });
  }

  /**
   * Track error
   */
  trackError(error, context = {}) {
    this.track(ANALYTICS_EVENTS.ERROR_OCCURRED, {
      error_message: error.message,
      error_stack: error.stack,
      ...context,
    });
  }

  /**
   * Get device type
   */
  getDeviceType() {
    const ua = navigator.userAgent;
    if (/iPad|iPhone|iPod/.test(ua)) return 'ios';
    if (/Android/.test(ua)) return 'android';
    if (window.innerWidth <= 768) return 'mobile';
    return 'desktop';
  }

  /**
   * Set user ID
   */
  setUserId(userId) {
    if (typeof window.gtag === 'function') {
      window.gtag('set', { user_id: userId });
    }
  }

  /**
   * Set user properties
   */
  setUserProperties(properties) {
    if (typeof window.gtag === 'function') {
      window.gtag('set', 'user_properties', properties);
    }
  }
}

// Create singleton instance
const analytics = new AnalyticsService();

// Initialize on load
if (typeof window !== 'undefined') {
  window.addEventListener('load', () => {
    analytics.init();
  });
}

export default analytics;