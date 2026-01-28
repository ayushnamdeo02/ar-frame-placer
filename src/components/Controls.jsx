/**
 * Controls Component
 * AR viewer control interface with movement, rotation, scale controls
 */

import React from 'react';
import {
  Move,
  RotateCw,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Camera,
  Grid3x3,
  Maximize2,
  Minimize2,
  Eye,
  EyeOff,
} from 'lucide-react';
import useARStore from '../store/useARStore';
import { TRANSFORM_CONFIG } from '../utils/constants';

export default function Controls({
  onScreenshot,
  onToggleGrid,
  onToggleFullscreen,
  isFullscreen = false,
}) {
  const {
    position,
    rotation,
    scale,
    showControls,
    showGrid,
    setPosition,
    setRotation,
    setScale,
    toggleControls,
    resetTransform,
  } = useARStore();

  /**
   * Handle position changes
   */
  const handleMove = (axis, direction) => {
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
  };

  /**
   * Handle rotation changes
   */
  const handleRotate = (axis, direction) => {
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
  };

  /**
   * Handle scale changes
   */
  const handleScale = (increase) => {
    const step = TRANSFORM_CONFIG.SCALE_STEP;
    const newScale = increase ? scale + step : scale - step;
    const clampedScale = Math.max(
      TRANSFORM_CONFIG.MIN_SCALE,
      Math.min(TRANSFORM_CONFIG.MAX_SCALE, newScale)
    );
    setScale(clampedScale);
  };

  if (!showControls) {
    return (
      <button
        className="btn-toggle-controls"
        onClick={toggleControls}
        title="Show Controls (C)"
      >
        <Eye size={16} />
        <span>Show Controls</span>
      </button>
    );
  }

  return (
    <>
      {/* Main Controls Container */}
      <div className="ar-controls-wrapper">
        {/* Movement Controls */}
        <div className="controls-section movement-section">
          <div className="controls-grid">
            {/* Up Arrow */}
            <div className="control-cell center">
              <button
                className="control-btn"
                onClick={() => handleMove('y', 1)}
                title="Move Up (↑)"
                aria-label="Move up"
              >
                ↑
              </button>
            </div>

            {/* Middle Row: Left, Center (Screenshot), Right */}
            <div className="control-cell left">
              <button
                className="control-btn"
                onClick={() => handleMove('x', -1)}
                title="Move Left (←)"
                aria-label="Move left"
              >
                ←
              </button>
            </div>

            <div className="control-cell center">
              <button
                className="control-btn primary-btn"
                onClick={onScreenshot}
                title="Capture Screenshot (S)"
                aria-label="Take screenshot"
              >
                <Camera size={24} />
              </button>
            </div>

            <div className="control-cell right">
              <button
                className="control-btn"
                onClick={() => handleMove('x', 1)}
                title="Move Right (→)"
                aria-label="Move right"
              >
                →
              </button>
            </div>

            {/* Down Arrow */}
            <div className="control-cell center">
              <button
                className="control-btn"
                onClick={() => handleMove('y', -1)}
                title="Move Down (↓)"
                aria-label="Move down"
              >
                ↓
              </button>
            </div>
          </div>
        </div>

        {/* Action Controls Bar */}
        <div className="controls-section action-section">
          <div className="action-controls-bar">
            {/* Zoom Out */}
            <button
              className="control-btn-small"
              onClick={() => handleScale(false)}
              title="Zoom Out (-)"
              aria-label="Zoom out"
              disabled={scale <= TRANSFORM_CONFIG.MIN_SCALE}
            >
              <ZoomOut size={18} />
            </button>

            {/* Rotate Left */}
            <button
              className="control-btn-small"
              onClick={() => handleRotate('y', -1)}
              title="Rotate Left"
              aria-label="Rotate left"
            >
              <RotateCw size={18} style={{ transform: 'scaleX(-1)' }} />
            </button>

            {/* Rotate Right */}
            <button
              className="control-btn-small"
              onClick={() => handleRotate('y', 1)}
              title="Rotate Right"
              aria-label="Rotate right"
            >
              <RotateCw size={18} />
            </button>

            {/* Zoom In */}
            <button
              className="control-btn-small"
              onClick={() => handleScale(true)}
              title="Zoom In (+)"
              aria-label="Zoom in"
              disabled={scale >= TRANSFORM_CONFIG.MAX_SCALE}
            >
              <ZoomIn size={18} />
            </button>

            {/* Divider */}
            <div className="control-divider" />

            {/* Toggle Grid */}
            <button
              className={`control-btn-small ${showGrid ? 'active' : ''}`}
              onClick={onToggleGrid}
              title="Toggle Grid (G)"
              aria-label="Toggle grid"
            >
              <Grid3x3 size={18} />
            </button>

            {/* Toggle Fullscreen */}
            <button
              className="control-btn-small"
              onClick={onToggleFullscreen}
              title="Toggle Fullscreen"
              aria-label="Toggle fullscreen"
            >
              {isFullscreen ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
            </button>

            {/* Divider */}
            <div className="control-divider" />

            {/* Reset Transform */}
            <button
              className="control-btn-small reset-btn"
              onClick={resetTransform}
              title="Reset Position (R)"
              aria-label="Reset position"
            >
              <RotateCcw size={18} />
            </button>
          </div>
        </div>

        {/* Advanced Controls (Optional - Hidden by default) */}
        <div className="controls-section advanced-section" style={{ display: 'none' }}>
          <div className="advanced-controls">
            {/* Depth Controls */}
            <div className="control-group">
              <label>Depth</label>
              <div className="control-buttons-horizontal">
                <button
                  className="control-btn-mini"
                  onClick={() => handleMove('z', -1)}
                  title="Move Closer"
                >
                  +
                </button>
                <button
                  className="control-btn-mini"
                  onClick={() => handleMove('z', 1)}
                  title="Move Away"
                >
                  -
                </button>
              </div>
            </div>

            {/* Rotation X */}
            <div className="control-group">
              <label>Tilt</label>
              <div className="control-buttons-horizontal">
                <button
                  className="control-btn-mini"
                  onClick={() => handleRotate('x', -1)}
                  title="Tilt Up"
                >
                  ↑
                </button>
                <button
                  className="control-btn-mini"
                  onClick={() => handleRotate('x', 1)}
                  title="Tilt Down"
                >
                  ↓
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Info Display */}
        <div className="controls-info">
          <div className="info-item">
            <span className="info-label">Scale:</span>
            <span className="info-value">{scale.toFixed(2)}x</span>
          </div>
          <div className="info-item">
            <span className="info-label">Position:</span>
            <span className="info-value">
              X: {position.x.toFixed(1)} Y: {position.y.toFixed(1)}
            </span>
          </div>
        </div>
      </div>

      {/* Toggle Controls Button */}
      <button
        className="btn-toggle-controls"
        onClick={toggleControls}
        title="Hide Controls (C)"
      >
        <EyeOff size={16} />
        <span>Hide Controls</span>
      </button>

      {/* Keyboard Shortcuts Hint */}
      <div className="keyboard-hints">
        <div className="hint">
          <kbd>Arrow Keys</kbd> <span>Move</span>
        </div>
        <div className="hint">
          <kbd>+ / -</kbd> <span>Zoom</span>
        </div>
        <div className="hint">
          <kbd>R</kbd> <span>Reset</span>
        </div>
        <div className="hint">
          <kbd>S</kbd> <span>Screenshot</span>
        </div>
        <div className="hint">
          <kbd>C</kbd> <span>Toggle Controls</span>
        </div>
      </div>

      {/* CSS Styles */}
      <style jsx>{`
        .ar-controls-wrapper {
          position: fixed;
          bottom: 2rem;
          left: 50%;
          transform: translateX(-50%);
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1rem;
          z-index: 1000;
        }

        .controls-section {
          background: rgba(0, 0, 0, 0.8);
          backdrop-filter: blur(20px);
          border-radius: 24px;
          padding: 1rem;
        }

        .movement-section {
          padding: 0.75rem;
        }

        .controls-grid {
          display: grid;
          grid-template-columns: repeat(3, 56px);
          grid-template-rows: repeat(3, 56px);
          gap: 0.5rem;
        }

        .control-cell {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .control-cell.center {
          grid-column: 2;
        }

        .control-cell.left {
          grid-column: 1;
          grid-row: 2;
        }

        .control-cell.right {
          grid-column: 3;
          grid-row: 2;
        }

        .control-btn {
          width: 56px;
          height: 56px;
          background: rgba(255, 255, 255, 0.95);
          border: none;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 1.5rem;
          font-weight: 700;
          color: #000;
          cursor: pointer;
          transition: all 0.2s ease;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        }

        .control-btn:hover:not(:disabled) {
          transform: scale(1.1);
          background: #fff;
        }

        .control-btn:active {
          transform: scale(0.95);
        }

        .control-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .primary-btn {
          width: 72px;
          height: 72px;
          background: #007AFF;
          color: white;
        }

        .primary-btn:hover {
          background: #0051D5;
        }

        .action-section {
          padding: 0.75rem 1.5rem;
        }

        .action-controls-bar {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .control-btn-small {
          width: 44px;
          height: 44px;
          background: rgba(255, 255, 255, 0.95);
          border: none;
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #000;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .control-btn-small:hover:not(:disabled) {
          transform: scale(1.1);
          background: #fff;
        }

        .control-btn-small:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .control-btn-small.active {
          background: #007AFF;
          color: white;
        }

        .reset-btn:hover {
          background: #FF3B30;
          color: white;
        }

        .control-divider {
          width: 1px;
          height: 24px;
          background: rgba(255, 255, 255, 0.3);
        }

        .controls-info {
          display: flex;
          gap: 1.5rem;
          padding: 0.75rem 1.5rem;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(10px);
          border-radius: 20px;
          font-size: 0.875rem;
          color: white;
        }

        .info-item {
          display: flex;
          gap: 0.5rem;
        }

        .info-label {
          opacity: 0.7;
        }

        .info-value {
          font-weight: 600;
          font-family: 'Monaco', 'Courier New', monospace;
        }

        .keyboard-hints {
          display: flex;
          flex-wrap: wrap;
          gap: 0.75rem;
          padding: 0.75rem;
          background: rgba(0, 0, 0, 0.6);
          backdrop-filter: blur(10px);
          border-radius: 16px;
          font-size: 0.75rem;
          color: white;
          justify-content: center;
        }

        .hint {
          display: flex;
          align-items: center;
          gap: 0.5rem;
        }

        kbd {
          padding: 0.25rem 0.5rem;
          background: rgba(255, 255, 255, 0.2);
          border: 1px solid rgba(255, 255, 255, 0.3);
          border-radius: 4px;
          font-family: 'Monaco', 'Courier New', monospace;
          font-size: 0.7rem;
          font-weight: 600;
        }

        @media (max-width: 768px) {
          .ar-controls-wrapper {
            bottom: 1rem;
          }

          .controls-grid {
            grid-template-columns: repeat(3, 48px);
            grid-template-rows: repeat(3, 48px);
          }

          .control-btn {
            width: 48px;
            height: 48px;
            font-size: 1.25rem;
          }

          .primary-btn {
            width: 64px;
            height: 64px;
          }

          .control-btn-small {
            width: 40px;
            height: 40px;
          }

          .keyboard-hints {
            display: none;
          }

          .controls-info {
            font-size: 0.75rem;
            padding: 0.5rem 1rem;
          }
        }
      `}</style>
    </>
  );
}