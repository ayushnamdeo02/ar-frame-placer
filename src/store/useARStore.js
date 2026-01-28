/**
 * Global State Store using Zustand
 * Manages AR application state including model, camera, and transform data
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';

const useARStore = create(
  devtools(
    persist(
      (set, get) => ({
        // Model State
        currentModel: null,
        modelType: 'frame', // 'frame' | 'wallpaper'
        modelMetadata: null,
        
        // Transform State
        position: { x: 0, y: 0, z: -2 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: 1,
        
        // AR State
        isPlaced: false,
        cameraActive: false,
        isLoading: false,
        error: null,
        
        // UI State
        showControls: true,
        showGrid: false,
        
        // History for undo/redo
        history: [],
        historyIndex: -1,
        
        // Actions
        setModel: (modelUrl, type = 'frame', metadata = null) => {
          set({
            currentModel: modelUrl,
            modelType: type,
            modelMetadata: metadata,
            isPlaced: false,
            error: null,
          });
        },
        
        setPosition: (position) => {
          const state = get();
          set({
            position,
            history: [...state.history.slice(0, state.historyIndex + 1), { position }],
            historyIndex: state.historyIndex + 1,
          });
        },
        
        setRotation: (rotation) => {
          const state = get();
          set({
            rotation,
            history: [...state.history.slice(0, state.historyIndex + 1), { rotation }],
            historyIndex: state.historyIndex + 1,
          });
        },
        
        setScale: (scale) => {
          const clampedScale = Math.max(0.1, Math.min(5, scale));
          const state = get();
          set({
            scale: clampedScale,
            history: [...state.history.slice(0, state.historyIndex + 1), { scale: clampedScale }],
            historyIndex: state.historyIndex + 1,
          });
        },
        
        setPlaced: (isPlaced) => set({ isPlaced }),
        
        setCameraActive: (active) => set({ cameraActive: active }),
        
        setLoading: (isLoading) => set({ isLoading }),
        
        setError: (error) => set({ error }),
        
        toggleControls: () => set((state) => ({ showControls: !state.showControls })),
        
        toggleGrid: () => set((state) => ({ showGrid: !state.showGrid })),
        
        resetTransform: () => {
          set({
            position: { x: 0, y: 0, z: -2 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: 1,
          });
        },
        
        undo: () => {
          const state = get();
          if (state.historyIndex > 0) {
            const prevState = state.history[state.historyIndex - 1];
            set({
              ...prevState,
              historyIndex: state.historyIndex - 1,
            });
          }
        },
        
        redo: () => {
          const state = get();
          if (state.historyIndex < state.history.length - 1) {
            const nextState = state.history[state.historyIndex + 1];
            set({
              ...nextState,
              historyIndex: state.historyIndex + 1,
            });
          }
        },
        
        clearHistory: () => {
          set({
            history: [],
            historyIndex: -1,
          });
        },
        
        reset: () => {
          set({
            currentModel: null,
            modelType: 'frame',
            modelMetadata: null,
            position: { x: 0, y: 0, z: -2 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: 1,
            isPlaced: false,
            cameraActive: false,
            isLoading: false,
            error: null,
            showControls: true,
            showGrid: false,
            history: [],
            historyIndex: -1,
          });
        },
      }),
      {
        name: 'ar-frame-placer-storage',
        partialize: (state) => ({
          modelType: state.modelType,
          showControls: state.showControls,
          showGrid: state.showGrid,
        }),
      }
    ),
    { name: 'ARStore' }
  )
);

export default useARStore;