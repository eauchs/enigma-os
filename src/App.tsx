import React, { useState, useRef, useEffect, useCallback } from 'react';
// On importe le composant ET son type de ref
import Emulator, { EmulatorRef } from './components/Emulator';

// Le type pour l'état de l'agent
type AgentState = 'snapshot' | ArrayBuffer | null;

function App() {
  const [status, setStatus] = useState('Initializing Host...');
  const [isReadyForInput, setIsReadyForInput] = useState(false);
  const [serialOutput, setSerialOutput] = useState('');
  const [bootStage, setBootStage] = useState<'idle' | 'waitingLogin' | 'waitingShell' | 'done'>('idle');
  
  // On démarre par défaut depuis le snapshot.
  // La variable 'setInitialState' est retirée car non utilisée (pour l'instant).
  const [initialState] = useState<AgentState>(null);
  const usingSavedState = initialState !== 'snapshot' && initialState !== null;

  // On type la ref. C'est la correction clé pour l'erreur "serial0_send".
  const emulatorRef = useRef<EmulatorRef | null>(null);
  const hasBootstrapped = useRef(false);
  const bootStageRef = useRef<'idle' | 'waitingLogin' | 'waitingShell' | 'done'>('idle');

  // Cette fonction est appelée quand l'émulateur est prêt
  const updateStage = useCallback((stage: 'idle' | 'waitingLogin' | 'waitingShell' | 'done') => {
    bootStageRef.current = stage;
    setBootStage(stage);
  }, []);

  const handleEmulatorReady = useCallback(() => {
    if (hasBootstrapped.current) {
      console.log('Emulator already bootstrapped; skipping automation.');
      return;
    }
    hasBootstrapped.current = true;

    if (!usingSavedState) {
      setStatus('Emulator ready. DSL live ISO booted. Continue installation manually.');
      setIsReadyForInput(false);
      return;
    }

    updateStage('waitingLogin');
    setSerialOutput('');
    setStatus('Emulator ready. Waiting for prompts...');
    setIsReadyForInput(false);

    const emulator = emulatorRef.current;
    emulator?.runSerialCommand('');
  }, [updateStage, usingSavedState]);

  // C'est ici qu'on enverra les objectifs au VLM (plus tard)
  const handleObjectiveSubmit = (objective: string) => {
    if (!isReadyForInput) return;
    console.log("New objective for VLM:", objective);
    setStatus(`Objective received: "${objective}"`);
    // TODO: Implémenter la logique VLM (screenshot + appel Ollama)
    const emulator = emulatorRef.current;
    if (emulator) {
      emulator.runCommand(objective);
    }
  };

  const handleSerialOutput = useCallback((chunk: string) => {
    setSerialOutput((prev) => {
      const next = prev + chunk;
      return next.length > 4000 ? next.slice(-4000) : next;
    });
  }, []);

  useEffect(() => {
    if (!usingSavedState) {
      return;
    }

    const stage = bootStageRef.current;
    if (stage === 'done') return;
    const emulator = emulatorRef.current;
    if (!emulator) return;

    const lower = serialOutput.toLowerCase();
    const hasLoginPrompt = lower.includes('login:');

    const promptToken = 'localhost:~# ';
    const promptIndex = lower.lastIndexOf(promptToken);
    const promptIsClean =
      promptIndex !== -1 &&
      (promptIndex + promptToken.length >= lower.length ||
        lower[promptIndex + promptToken.length] === '\n' ||
        lower[promptIndex + promptToken.length] === '\r');

    if (stage === 'waitingLogin') {
      if (hasLoginPrompt) {
        setStatus('Login prompt detected. Logging in as root (serial)...');
        emulator.runSerialCommand('root');
        updateStage('waitingShell');
        return;
      }
      if (promptIsClean) {
        setStatus('Shell prompt detected. Launching GUI (keyboard)...');
        emulator.runKeyboardCommand('cd /root && ./startx.sh');
        updateStage('done');
        setTimeout(() => {
          setStatus('Agent GUI is running. Ready for VLM control.');
          setIsReadyForInput(true);
        }, 4000);
      }
    } else if (stage === 'waitingShell') {
      if (promptIsClean) {
        setStatus('Shell ready after login. Launching GUI (keyboard)...');
        emulator.runKeyboardCommand('cd /root && ./startx.sh');
        updateStage('done');
        setTimeout(() => {
          setStatus('Agent GUI is running. Ready for VLM control.');
          setIsReadyForInput(true);
        }, 4000);
      }
    }
  }, [serialOutput, updateStage, usingSavedState]);

  useEffect(() => {
    if (!usingSavedState) {
      return;
    }

    const stage = bootStageRef.current;
    if (!emulatorRef.current) {
      return;
    }
    if (stage === 'waitingLogin') {
      const timer = setTimeout(() => {
        if (bootStageRef.current !== 'waitingLogin') {
          return;
        }
        setStatus('No login prompt detected; sending root manually...');
        emulatorRef.current?.runSerialCommand('root');
        updateStage('waitingShell');
      }, 7000);
      return () => clearTimeout(timer);
    }
    if (stage === 'waitingShell') {
      const timer = setTimeout(() => {
        if (bootStageRef.current !== 'waitingShell') {
          return;
        }
        setStatus('Shell prompt still not detected; launching GUI anyway...');
        emulatorRef.current?.runKeyboardCommand('cd /root && ./startx.sh');
        updateStage('done');
        setTimeout(() => {
          setStatus('Agent GUI is running. Ready for VLM control.');
          setIsReadyForInput(true);
        }, 4000);
      }, 6000);
      return () => clearTimeout(timer);
    }
    return;
  }, [bootStage, updateStage, usingSavedState]);

  return (
    // L'import de 'React' corrige les erreurs "Property 'div' does not exist"
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#1e1e1e', color: 'white' }}>
      <header style={{ padding: '10px', background: '#252526', textAlign: 'center', flexShrink: 0 }}>
        <h1>Sovereign Agent Host</h1>
        <p>Status: {status}</p>
      </header>
      <main style={{ flex: 1, padding: '10px', minHeight: 0 }}>
        <Emulator 
            ref={emulatorRef}
            initialState={usingSavedState ? initialState : undefined}
            onReady={handleEmulatorReady}
            onOutput={handleSerialOutput}
        />
      </main>
      <footer style={{ padding: '10px', flexShrink: 0 }}>
        <input 
          type="text" 
          placeholder="Enter objective for the agent..." 
          disabled={!isReadyForInput}
          // On type l'événement 'e' pour corriger l'erreur d'inférence
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') {
              handleObjectiveSubmit(e.currentTarget.value);
              e.currentTarget.value = '';
            }
          }}
          style={{ width: '100%', padding: '10px', background: '#3c3c3c', border: '1px solid #555', color: 'white', borderRadius: '5px' }}
        />
      </footer>
    </div>
  );
}

export default App;
