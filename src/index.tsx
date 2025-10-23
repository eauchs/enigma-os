import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App' // Assuming App.tsx is the main component
import './index.css' // Assuming there might be a global CSS file

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)