import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReactFlowProvider } from '@xyflow/react';
import App from './App';
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/be-vietnam-pro/700.css';
import '@fontsource/ibm-plex-mono/400.css';
import '@fontsource/ibm-plex-mono/500.css';
import '@xyflow/react/dist/style.css';
import './schematic.css';
import './compact.css';

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><ReactFlowProvider><App /></ReactFlowProvider></React.StrictMode>);
