// src/App.js
import React, { useState } from 'react';
import AdvancedWebAR from './components/AdvancedWebAR';
import HomePage from './components/HomePage';
import UploadPage from './components/UploadPage';
import useARStore from './store/useARStore';
import './styles/App.css';

function App() {
  const [currentView, setCurrentView] = useState('home');
  const { currentModel } = useARStore();

  return (
    <div className="app">
      {currentView === 'home' && <HomePage onNavigate={setCurrentView} />}
      {currentView === 'upload' && <UploadPage onNavigate={setCurrentView} />}
      {currentView === 'ar' && currentModel && (
        <AdvancedWebAR onClose={() => setCurrentView('upload')} />
      )}
    </div>
  );
}

export default App;