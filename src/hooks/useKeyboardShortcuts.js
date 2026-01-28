/**
 * useKeyboardShortcuts Hook
 * Custom hook for managing keyboard shortcuts
 */

import { useEffect, useCallback } from 'react';
import { KEYBOARD_SHORTCUTS } from '../utils/constants';

export const useKeyboardShortcuts = (handlers = {}) => {
  const handleKeyDown = useCallback(
    (event) => {
      const key = event.key.toLowerCase();
      const isCtrlOrCmd = event.ctrlKey || event.metaKey;

      // Prevent default for our shortcuts
      const shouldPreventDefault = Object.values(KEYBOARD_SHORTCUTS).includes(key);
      if (shouldPreventDefault && !event.target.matches('input, textarea')) {
        event.preventDefault();
      }

      // Don't trigger shortcuts if user is typing in input fields
      if (event.target.matches('input, textarea, select')) {
        return;
      }

      // Handle shortcuts
      switch (key) {
        case KEYBOARD_SHORTCUTS.RESET:
          handlers.onReset?.();
          break;

        case KEYBOARD_SHORTCUTS.TOGGLE_CONTROLS:
          handlers.onToggleControls?.();
          break;

        case KEYBOARD_SHORTCUTS.TOGGLE_GRID:
          handlers.onToggleGrid?.();
          break;

        case KEYBOARD_SHORTCUTS.SCREENSHOT:
          handlers.onScreenshot?.();
          break;

        case KEYBOARD_SHORTCUTS.UNDO:
          if (isCtrlOrCmd) {
            handlers.onUndo?.();
          }
          break;

        case KEYBOARD_SHORTCUTS.REDO:
          if (isCtrlOrCmd) {
            handlers.onRedo?.();
          }
          break;

        case KEYBOARD_SHORTCUTS.CLOSE:
          handlers.onClose?.();
          break;

        // Arrow keys for movement
        case 'arrowup':
          handlers.onMoveUp?.();
          break;

        case 'arrowdown':
          handlers.onMoveDown?.();
          break;

        case 'arrowleft':
          handlers.onMoveLeft?.();
          break;

        case 'arrowright':
          handlers.onMoveRight?.();
          break;

        // +/- for zoom
        case '+':
        case '=':
          handlers.onZoomIn?.();
          break;

        case '-':
        case '_':
          handlers.onZoomOut?.();
          break;

        default:
          break;
      }
    },
    [handlers]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  return null;
};

export default useKeyboardShortcuts;