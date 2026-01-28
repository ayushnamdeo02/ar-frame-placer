/** 
 * UploadPage Component 
 * Model upload and selection interface
 */
import React, { useState, useRef } from 'react';
import { Upload, Link2, ArrowLeft, CheckCircle2 } from 'lucide-react';
import useARStore from '../store/useARStore';
import analytics from '../services/analytics';
import { isValidGLBUrl, formatFileSize } from '../utils/helpers';
import { SAMPLE_MODELS, UPLOAD_CONFIG, ERROR_MESSAGES } from '../utils/constants';

export default function UploadPage({ onNavigate }) {
  const { setModel } = useARStore();
  const [selectedType, setSelectedType] = useState('frame');
  const [urlInput, setUrlInput] = useState('');
  const [validationError, setValidationError] = useState('');
  const fileInputRef = useRef(null);

  /**
   * Handle file upload from device
   */
  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.glb') && !file.name.endsWith('.gltf')) {
      setValidationError(ERROR_MESSAGES.INVALID_FILE_TYPE);
      return;
    }

    // Validate file size
    if (file.size > UPLOAD_CONFIG.MAX_FILE_SIZE) {
      setValidationError(ERROR_MESSAGES.FILE_TOO_LARGE);
      return;
    }

    // Create object URL for local file
    const objectUrl = URL.createObjectURL(file);
    
    setValidationError('');

    // Track upload
    analytics.trackModelUploaded({
      size: file.size,
      type: file.type,
      method: 'file',
    });

    // Load model
    setModel(objectUrl, selectedType, {
      source: 'upload',
      filename: file.name,
      size: file.size,
    });

    // Navigate to AR view
    onNavigate('ar');
  };

  /**
   * Handle URL input submission
   */
  const handleUrlSubmit = () => {
    setValidationError('');

    if (!urlInput.trim()) {
      setValidationError('Please enter a URL');
      return;
    }

    if (!isValidGLBUrl(urlInput)) {
      setValidationError(ERROR_MESSAGES.INVALID_URL);
      return;
    }

    // Track URL load
    analytics.trackModelLoaded({
      url: urlInput,
      type: selectedType,
      source: 'url',
    });

    // Load model
    setModel(urlInput, selectedType, {
      source: 'url',
    });

    // Navigate to AR view
    onNavigate('ar');
  };

  /**
   * Handle sample model selection
   */
  const handleSampleSelect = (sample) => {
    // Track sample selection
    analytics.trackModelLoaded({
      url: sample.glbUrl,
      type: sample.type,
      source: 'sample',
      sample_id: sample.id,
    });

    // Load model
    setModel(sample.glbUrl, sample.type, {
      source: 'sample',
      sample_id: sample.id,
      sample_name: sample.name,
    });

    // Navigate to AR view
    onNavigate('ar');
  };

  /**
   * Trigger file input click
   */
  const triggerFileInput = () => {
    fileInputRef.current?.click();
  };

  return (
    <div className="upload-page">
      {/* Header */}
      <div className="upload-header">
        <button onClick={() => onNavigate('home')} className="btn-icon">
          <ArrowLeft size={24} />
        </button>
        <h1>Load 3D Model</h1>
        <div style={{ width: 40 }} /> {/* Spacer for centering */}
      </div>

      <div className="upload-content">
        {/* Type Selector */}
        <div className="upload-section">
          <h2>Select Type</h2>
          <p className="section-description">Select what type of item you want to place</p>
          
          <div className="type-selector">
            <button
              className={`type-btn ${selectedType === 'frame' ? 'active' : ''}`}
              onClick={() => setSelectedType('frame')}
            >
              <div className="type-info">
                <span className="type-name">Picture Frame</span>
                <span className="type-desc">Place frames on walls</span>
              </div>
              {selectedType === 'frame' && <CheckCircle2 className="check-icon" size={24} />}
            </button>

            <button
              className={`type-btn ${selectedType === 'wallpaper' ? 'active' : ''}`}
              onClick={() => setSelectedType('wallpaper')}
            >
              <div className="type-info">
                <span className="type-name">Wallpaper</span>
                <span className="type-desc">Visualize wall coverings</span>
              </div>
              {selectedType === 'wallpaper' && <CheckCircle2 className="check-icon" size={24} />}
            </button>
          </div>
        </div>

        {/* Upload Methods */}
        <div className="upload-section">
          <h2>Choose Upload Method</h2>
          <p className="section-description">Choose how you want to load your 3D model</p>

          <div className="upload-methods">
            {/* File Upload */}
            <div className="upload-card" onClick={triggerFileInput}>
              <Upload className="upload-icon" size={48} />
              <h3>Upload File</h3>
              <p>Select a .glb file from your device</p>
              <span className="upload-hint">Max {formatFileSize(UPLOAD_CONFIG.MAX_FILE_SIZE)}</span>
              <input
                ref={fileInputRef}
                type="file"
                accept=".glb,.gltf"
                onChange={handleFileUpload}
                style={{ display: 'none' }}
              />
            </div>

            {/* URL Input */}
            <div className="upload-card">
              <Link2 className="upload-icon" size={48} />
              <h3>Load from URL</h3>
              <input
                type="url"
                placeholder="https://example.com/model.glb"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="url-input"
              />
              <button onClick={handleUrlSubmit} className="btn btn-primary">
                Load Model
              </button>
            </div>
          </div>

          {validationError && (
            <div className="error-message">{validationError}</div>
          )}
        </div>

        {/* Sample Models */}
        <div className="upload-section">
          <h2>Try Sample Models</h2>
          <p className="section-description">
            Select from our pre-loaded demo models to test the AR experience
          </p>

          <div className="sample-grid">
            {SAMPLE_MODELS.filter(s => s.type === selectedType).map((sample) => (
              <div
                key={sample.id}
                className="sample-card"
                onClick={() => handleSampleSelect(sample)}
              >
                <div className="sample-thumbnail">
                  <img src={sample.thumbnail} alt={sample.name} />
                </div>
                <div className="sample-info">
                  <h4>{sample.name}</h4>
                  <p>{sample.description}</p>
                  <span className="sample-type">{sample.type}</span>
                </div>
              </div>
            ))}
            {SAMPLE_MODELS.filter(s => s.type === selectedType).length === 0 && (
              <p className="no-samples">No sample models available for {selectedType}s yet.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
