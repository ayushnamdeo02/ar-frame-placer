/**
 * HomePage Component
 * Landing page with hero section, features, and navigation
 */

import React from 'react';
import { Camera, Upload, Grid, Move, Maximize2, Download, Zap, Shield, Smartphone } from 'lucide-react';
import { supportsAR, getDeviceType } from '../utils/helpers';
import { DEVICE_SUPPORT } from '../utils/constants';

export default function HomePage({ onNavigate }) {
  const [deviceSupport, setDeviceSupport] = React.useState(null);
  
  React.useEffect(() => {
    const deviceType = getDeviceType();
    const isSupported = supportsAR();
    setDeviceSupport({
      type: deviceType,
      supported: isSupported,
      info: DEVICE_SUPPORT[deviceType] || DEVICE_SUPPORT.desktop,
    });
  }, []);

  return (
    <div className="home-page">
      {/* Hero Section */}
      <div className="hero-section">
        <div className="hero-background">
          <div className="gradient-orb orb-1"></div>
          <div className="gradient-orb orb-2"></div>
          <div className="gradient-orb orb-3"></div>
        </div>
        
        <div className="hero-content">
          <div className="logo-badge">
            <Camera size={32} strokeWidth={2} />
          </div>
          
          <h1 className="hero-title">
            AR Frame Placer
          </h1>
          
          <p className="hero-subtitle">
            Visualize picture frames and wallpapers on your walls using augmented reality.
            See exactly how they'll look before you buy.
          </p>
          
          <div className="cta-buttons">
            <button 
              className="btn btn-primary"
              onClick={() => onNavigate('upload')}
            >
              <Camera size={20} />
              <span>Start AR Experience</span>
            </button>
            
            <button 
              className="btn btn-secondary"
              onClick={() => onNavigate('upload')}
            >
              <Grid size={20} />
              <span>Browse Samples</span>
            </button>
          </div>
          
          {deviceSupport && deviceSupport.supported && (
            <div className="device-badge">
              <Smartphone size={16} />
              <span>{deviceSupport.info.name} - {deviceSupport.info.status}</span>
            </div>
          )}
        </div>
      </div>
      
      {/* Features Section */}
      <div className="features-section">
        <div className="section-header">
          <h2>Powerful Features</h2>
          <p>Everything you need for the perfect AR placement experience</p>
        </div>
        
        <div className="features-grid">
          <div className="feature-card">
            <div className="feature-icon">
              <Camera size={28} />
            </div>
            <h3>Live AR Preview</h3>
            <p>
              See frames and wallpapers on your actual walls in real-time using 
              your device's camera.
            </p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">
              <Move size={28} />
            </div>
            <h3>Full Control</h3>
            <p>
              Move, rotate, and scale frames freely to find the perfect placement 
              with intuitive touch controls.
            </p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">
              <Download size={28} />
            </div>
            <h3>Screenshot Capture</h3>
            <p>
              Save high-quality screenshots of your AR placements to share with 
              others or keep for reference.
            </p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">
              <Upload size={28} />
            </div>
            <h3>Easy Upload</h3>
            <p>
              Upload your own 3D models or load them from URLs. Support for 
              .glb format with compression.
            </p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">
              <Zap size={28} />
            </div>
            <h3>Fast Performance</h3>
            <p>
              Optimized 3D rendering ensures smooth 60 FPS experience even on 
              mobile devices.
            </p>
          </div>
          
          <div className="feature-card">
            <div className="feature-icon">
              <Shield size={28} />
            </div>
            <h3>Privacy First</h3>
            <p>
              All AR processing happens on your device. No data is sent to 
              servers without your consent.
            </p>
          </div>
        </div>
      </div>
      
      {/* Device Support Section */}
      <div className="support-section">
        <div className="section-header">
          <h2>Device Support</h2>
          <p>Works seamlessly across all your devices</p>
        </div>
        
        <div className="support-table">
          <div className="support-header">
            <div className="support-col">Device</div>
            <div className="support-col">Camera</div>
            <div className="support-col">Gestures</div>
            <div className="support-col">Screenshot</div>
            <div className="support-col">Status</div>
          </div>
          
          {Object.entries(DEVICE_SUPPORT).map(([key, device]) => (
            <div key={key} className="support-row">
              <div className="support-col">
                <Smartphone size={16} />
                <span>{device.name}</span>
              </div>
              <div className="support-col">
                <span className="badge badge-success">
                  {device.camera ? '✓' : '✗'}
                </span>
              </div>
              <div className="support-col">
                <span className="badge badge-success">
                  {device.gestures ? '✓' : '✗'}
                </span>
              </div>
              <div className="support-col">
                <span className="badge badge-success">
                  {device.screenshot ? '✓' : '✗'}
                </span>
              </div>
              <div className="support-col">
                <span className="status-badge">{device.status}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
      
      {/* CTA Section */}
      <div className="cta-section">
        <div className="cta-content">
          <h2>Ready to Transform Your Space?</h2>
          <p>Start visualizing frames on your walls in augmented reality today.</p>
          <button 
            className="btn btn-primary btn-large"
            onClick={() => onNavigate('upload')}
          >
            <Maximize2 size={24} />
            <span>Launch AR Experience</span>
          </button>
        </div>
      </div>
      
      {/* Footer */}
      <footer className="footer">
        <div className="footer-content">
          <div className="footer-section">
            <h4>AR Frame Placer</h4>
            <p>Professional AR visualization for interior design and e-commerce.</p>
          </div>
          
          <div className="footer-section">
            <h4>Features</h4>
            <ul>
              <li>Live AR Preview</li>
              <li>3D Model Support</li>
              <li>Screenshot Capture</li>
              <li>API Integration</li>
            </ul>
          </div>
          
          <div className="footer-section">
            <h4>Support</h4>
            <ul>
              <li>Documentation</li>
              <li>API Reference</li>
              <li>Troubleshooting</li>
              <li>Contact Us</li>
            </ul>
          </div>
          
          <div className="footer-section">
            <h4>Legal</h4>
            <ul>
              <li>Privacy Policy</li>
              <li>Terms of Service</li>
              <li>Cookie Policy</li>
            </ul>
          </div>
        </div>
        
        <div className="footer-bottom">
          <p>&copy; 2026 AR Frame Placer. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}