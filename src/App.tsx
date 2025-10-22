import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  ChangeEvent,
  FormEvent
} from 'react';
import Emulator, {
  EmulatorRef,
  EmulatorDownloadEvent,
  EmulatorDownloadError
} from './components/Emulator';
import ActionPlaybook from './components/ActionPlaybook';
import { ACTION_PLAYBOOKS, ActionPlaybookEntry } from './data/actionPlaybooks';
import {
  useSnapshotStorage,
  SnapshotStage,
  SnapshotSource,
  StoredSnapshotRecord
} from './hooks/useSnapshotStorage';
import { useActionRunner } from './hooks/useActionRunner';
import { formatFileSize, formatTimestamp, normalizeResourceName } from './utils/format';

const MAX_SERIAL_BUFFER = 6000;

type BootStage = 'idle' | 'waitingLogin' | 'waitingShell' | 'done';

const STAGE_ORDER: BootStage[] = ['idle', 'waitingLogin', 'waitingShell', 'done'];

type StageContent = {
  title: string;
  summary: string;
  timelineSummary: string;
};

const SNAPSHOT_STAGE_CONTENT: Record<BootStage, StageContent> = {
  idle: {
    title: 'Restoring agent state',
    summary: 'Rehydrating the saved Âme and preparing the sovereign workspace.',
    timelineSummary: 'Load saved memory snapshot'
  },
  waitingLogin: {
    title: 'Watching for login prompt',
    summary: 'Authenticating over the serial console to recover the last session.',
    timelineSummary: 'Detect login prompt'
  },
  waitingShell: {
    title: 'Preparing shell environment',
    summary: 'Opening a root shell and bootstrapping the graphical interface.',
    timelineSummary: 'Log into shell'
  },
  done: {
    title: 'Launching agent GUI',
    summary: 'Starting the graphical desktop so objectives and macros can resume.',
    timelineSummary: 'Start graphical agent'
  }
};

const MANUAL_STAGE_CONTENT: Record<BootStage, StageContent> = {
  idle: {
    title: 'First boot in progress',
    summary: 'No saved Âme detected. Use the live environment to install the agent.',
    timelineSummary: 'Boot live ISO'
  },
  waitingLogin: {
    title: 'Manual login required',
    summary: 'Enter the root credentials inside the VM when the prompt appears.',
    timelineSummary: 'Log in manually'
  },
  waitingShell: {
    title: 'Launch GUI manually',
    summary: 'Run “cd /root && ./startx.sh” in the VM to start the desktop.',
    timelineSummary: 'Start graphical environment manually'
  },
  done: {
    title: 'Capture an Âme',
    summary: 'Once configured, capture a snapshot to unlock automatic resumes.',
    timelineSummary: 'Capture persistent state'
  }
};

const SNAPSHOT_STAGE_LABEL: Record<SnapshotStage, string> = {
  checking: 'Checking storage',
  importing: 'Importing Âme',
  ready: 'Ready',
  missing: 'Not loaded',
  error: 'Error'
};

const SNAPSHOT_SOURCE_LABEL: Record<Exclude<SnapshotSource, 'none'>, string> = {
  stored: 'Restored from cache',
  uploaded: 'Imported locally',
  remote: 'Fetched remotely',
  captured: 'Captured this session'
};

const App: React.FC = () => {
  const [status, setStatus] = useState('Checking for stored Âme…');
  const [isReadyForInput, setIsReadyForInput] = useState(false);
  const [serialOutput, setSerialOutput] = useState('');
  const [bootStage, setBootStage] = useState<BootStage>('idle');
  const [downloadState, setDownloadState] = useState<
    Record<string, { loaded: number; total?: number; error?: string }>
  >({});
  const [instanceSeed, setInstanceSeed] = useState(0);
  const [objectiveFeedback, setObjectiveFeedback] = useState<string | null>(null);
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteError, setRemoteError] = useState<string | null>(null);
  const [isFetchingRemote, setIsFetchingRemote] = useState(false);
  const [isCapturingSnapshot, setIsCapturingSnapshot] = useState(false);
  const [snapshotFeedback, setSnapshotFeedback] = useState<string | null>(null);
  const [actionFeedback, setActionFeedback] = useState<string | null>(null);

  const emulatorRef = useRef<EmulatorRef | null>(null);
  const logViewportRef = useRef<HTMLDivElement>(null);
  const objectiveInputRef = useRef<HTMLInputElement>(null);
  const snapshotInputRef = useRef<HTMLInputElement>(null);
  const hasBootstrapped = useRef(false);
  const bootStageRef = useRef<BootStage>('idle');

  const {
    initialState,
    snapshotStage,
    snapshotMeta,
    snapshotError,
    snapshotSource,
    hasStoredSnapshot,
    loadSnapshot,
    importSnapshotFromFile,
    importSnapshotFromUrl,
    storeSnapshotFromBuffer,
    forgetSnapshot,
    getSnapshotRecord
  } = useSnapshotStorage();

  const usingSavedState = snapshotStage === 'ready' && hasStoredSnapshot;

  const {
    runAction,
    isRunning: isActionRunning,
    activeActionId,
    lastError: actionError
  } = useActionRunner(emulatorRef);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const result = await loadSnapshot();
      if (cancelled) return;
      if (result.found) {
        setStatus('Stored Âme found. Booting automatically…');
        setInstanceSeed((prev) => prev + 1);
      } else if (result.error) {
        setStatus('Snapshot storage error. Manual boot required.');
      } else {
        setStatus('No stored Âme detected. Manual boot is available or import one below.');
      }
    })().catch((error) => {
      console.error('Snapshot load failure', error);
      if (!cancelled) {
        setStatus('Snapshot storage error. Manual boot required.');
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadSnapshot]);

  useEffect(() => {
    hasBootstrapped.current = false;
    bootStageRef.current = 'idle';
    setBootStage('idle');
    setSerialOutput('');
    setIsReadyForInput(false);
    setDownloadState({});
    setActionFeedback(null);
    setObjectiveFeedback(null);
  }, [instanceSeed]);

  const updateStage = useCallback((stage: BootStage) => {
    bootStageRef.current = stage;
    setBootStage(stage);
  }, []);

  const handleEmulatorReady = useCallback(() => {
    if (hasBootstrapped.current) {
      return;
    }
    hasBootstrapped.current = true;

    if (!usingSavedState) {
      setStatus('Emulator ready. Follow the manual setup instructions to capture an Âme.');
      setIsReadyForInput(false);
      return;
    }

    updateStage('waitingLogin');
    setSerialOutput('');
    setStatus('Emulator ready. Waiting for prompts…');
    setIsReadyForInput(false);

    const emulator = emulatorRef.current;
    emulator?.runSerialCommand('');
  }, [updateStage, usingSavedState]);

  const handleSnapshotImport = useCallback(
    async (file: File) => {
      setStatus('Importing Âme…');
      setSnapshotFeedback(null);
      try {
        const record = await importSnapshotFromFile(file);
        setStatus(`Âme imported (${formatFileSize(record.size)}). Launching agent…`);
        setSnapshotFeedback(`Stored ${record.name} locally.`);
        setInstanceSeed((prev) => prev + 1);
      } catch (error) {
        const message = (error as Error)?.message ?? 'Snapshot import failed.';
        setSnapshotFeedback(message);
        setStatus('Snapshot import failed. Manual boot available.');
      }
    },
    [importSnapshotFromFile]
  );

  const handleSnapshotFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (file) {
        void handleSnapshotImport(file);
      }
    },
    [handleSnapshotImport]
  );

  const triggerSnapshotDialog = useCallback(() => {
    snapshotInputRef.current?.click();
  }, []);

  const handleForgetSnapshot = useCallback(async () => {
    setSnapshotFeedback(null);
    setStatus('Removing stored Âme…');
    try {
      await forgetSnapshot();
      setStatus('Stored Âme removed. Manual boot is available.');
      setInstanceSeed((prev) => prev + 1);
    } catch (error) {
      const message = (error as Error)?.message ?? 'Failed to remove stored snapshot.';
      setSnapshotFeedback(message);
      setStatus('Snapshot removal failed.');
    }
  }, [forgetSnapshot]);

  const handleRemoteImport = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const trimmed = remoteUrl.trim();
      if (!trimmed) {
        return;
      }
      setRemoteError(null);
      setSnapshotFeedback(null);
      setIsFetchingRemote(true);
      setStatus('Downloading Âme from remote storage…');
      try {
        const record = await importSnapshotFromUrl(trimmed);
        setStatus(`Remote Âme imported (${formatFileSize(record.size)}). Launching agent…`);
        setSnapshotFeedback(`Fetched ${record.name} from remote endpoint.`);
        setRemoteUrl('');
        setInstanceSeed((prev) => prev + 1);
      } catch (error) {
        const message = (error as Error)?.message ?? 'Remote import failed.';
        setRemoteError(message);
        setStatus('Remote import failed. Manual boot available.');
      } finally {
        setIsFetchingRemote(false);
      }
    },
    [importSnapshotFromUrl, remoteUrl]
  );

  const handleRemoteUrlChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setRemoteUrl(event.target.value);
  }, []);

  const handleCaptureSnapshot = useCallback(async () => {
    const emulator = emulatorRef.current;
    if (!emulator) {
      setSnapshotFeedback('Emulator is not ready to capture a snapshot.');
      return;
    }
    setIsCapturingSnapshot(true);
    setSnapshotFeedback(null);
    setStatus('Capturing Âme snapshot…');
    try {
      const buffer = await emulator.saveState();
      if (!buffer) {
        throw new Error('Emulator did not return a state image.');
      }
      const record = await storeSnapshotFromBuffer(
        buffer,
        {
          name: `agent-ame-${new Date().toISOString().replace(/[:.]/g, '-')}.bin`,
          size: buffer.byteLength,
          savedAt: Date.now()
        },
        { source: 'captured' }
      );
      setSnapshotFeedback(
        `Snapshot captured (${formatFileSize(record.size)}) at ${formatTimestamp(record.savedAt)}.`
      );
      setStatus('Snapshot captured and stored locally.');
    } catch (error) {
      const message = (error as Error)?.message ?? 'Snapshot capture failed.';
      setSnapshotFeedback(message);
      setStatus('Snapshot capture failed.');
    } finally {
      setIsCapturingSnapshot(false);
    }
  }, [storeSnapshotFromBuffer]);

  const handleDownloadSnapshot = useCallback(() => {
    const record = getSnapshotRecord();
    if (!record) {
      setSnapshotFeedback('No stored Âme available to download.');
      return;
    }
    try {
      const blob = new Blob([record.buffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = record.name || 'session.bin';
      anchor.click();
      URL.revokeObjectURL(url);
      setSnapshotFeedback(`Downloaded ${record.name} (${formatFileSize(record.size)}).`);
      setStatus('Snapshot download triggered.');
    } catch (error) {
      const message = (error as Error)?.message ?? 'Failed to download the stored Âme.';
      setSnapshotFeedback(message);
      setStatus('Snapshot download failed.');
    }
  }, [getSnapshotRecord]);

  const handleObjectiveSubmit = useCallback(
    (objective: string) => {
      if (!isReadyForInput) return;
      const trimmed = objective.trim();
      if (!trimmed) return;
      setObjectiveFeedback(`Objective queued: “${trimmed}”.`);
      setStatus(`Objective received: "${trimmed}"`);
      emulatorRef.current?.runCommand(trimmed);
    },
    [isReadyForInput]
  );

  const handleActionRun = useCallback(
    async (action: ActionPlaybookEntry) => {
      setActionFeedback(null);
      const result = await runAction(action);
      if (result.success) {
        setActionFeedback(`Playbook “${action.title}” completed.`);
        setStatus(`Playbook completed: ${action.title}`);
      } else {
        setActionFeedback(result.error ?? `Playbook “${action.title}” failed.`);
        setStatus(`Playbook failed: ${action.title}`);
      }
    },
    [runAction]
  );

  const handleActionCopy = useCallback(async (action: ActionPlaybookEntry) => {
    const payload = JSON.stringify(action, null, 2);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(payload);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = payload;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setActionFeedback(`Copied playbook “${action.title}” to clipboard.`);
    } catch (error) {
      const message = (error as Error)?.message ?? 'Unable to copy playbook to clipboard.';
      setActionFeedback(message);
    }
  }, []);

  const handleSerialOutput = useCallback((chunk: string) => {
    setSerialOutput((prev) => {
      const next = prev + chunk;
      return next.length > MAX_SERIAL_BUFFER ? next.slice(-MAX_SERIAL_BUFFER) : next;
    });
  }, []);

  const handleDownloadProgress = useCallback(
    (event: EmulatorDownloadEvent) => {
      setDownloadState((prev) => ({
        ...prev,
        [event.fileName]: {
          loaded: event.loaded,
          total: event.lengthComputable ? event.total : undefined,
          error: undefined
        }
      }));

      if (!isReadyForInput) {
        const fileLabel = normalizeResourceName(event.fileName);
        const { total, loaded } = event;
        const progress = total && total > 0 ? Math.round((loaded / total) * 100) : undefined;
        setStatus(
          progress !== undefined
            ? `Downloading ${fileLabel}… ${progress}%`
            : `Downloading ${fileLabel}… ${formatFileSize(loaded)}`
        );
      }
    },
    [isReadyForInput]
  );

  const handleDownloadError = useCallback((event: EmulatorDownloadError) => {
    setDownloadState((prev) => ({
      ...prev,
      [event.fileName]: {
        ...prev[event.fileName],
        error: event.status
          ? `HTTP ${event.status}${event.statusText ? ` ${event.statusText}` : ''}`
          : 'Download failed'
      }
    }));
    const resourceName = normalizeResourceName(event.fileName);
    setStatus(`Failed to download ${resourceName}. Ensure the asset is available in /public/images.`);
  }, []);

  const handleEmulatorError = useCallback((error: Error) => {
    console.error('Emulator encountered an error', error);
    setStatus(`Emulator error: ${error.message}`);
  }, []);

  useEffect(() => {
    const viewport = logViewportRef.current;
    if (!viewport) {
      return;
    }
    viewport.scrollTop = viewport.scrollHeight;
  }, [serialOutput]);

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
        setStatus('Login prompt detected. Logging in as root (serial)…');
        emulator.runSerialCommand('root');
        updateStage('waitingShell');
        return;
      }
      if (promptIsClean) {
        setStatus('Shell prompt detected. Launching GUI (keyboard)…');
        emulator.runKeyboardCommand('cd /root && ./startx.sh');
        updateStage('done');
        setTimeout(() => {
          setStatus('Agent GUI is running. Ready for VLM control.');
          setIsReadyForInput(true);
        }, 4000);
      }
    } else if (stage === 'waitingShell') {
      if (promptIsClean) {
        setStatus('Shell ready after login. Launching GUI (keyboard)…');
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
        setStatus('No login prompt detected; sending root manually…');
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
        setStatus('Shell prompt still not detected; launching GUI anyway…');
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

  const stageContent = useMemo(
    () => (usingSavedState ? SNAPSHOT_STAGE_CONTENT : MANUAL_STAGE_CONTENT),
    [usingSavedState]
  );

  const activeStageContent = stageContent[bootStage];

  const statusPillState = useMemo(() => {
    if (snapshotStage === 'error') {
      return 'error';
    }
    if (snapshotStage === 'importing') {
      return 'importing';
    }
    if (snapshotStage === 'checking') {
      return 'idle';
    }
    if (!usingSavedState) {
      return 'manual';
    }
    return isReadyForInput ? 'ready' : bootStage;
  }, [bootStage, isReadyForInput, snapshotStage, usingSavedState]);

  const statusPillLabel = useMemo(() => {
    if (snapshotStage === 'error') {
      return 'Snapshot error';
    }
    if (snapshotStage === 'importing') {
      return 'Importing Âme';
    }
    if (snapshotStage === 'checking') {
      return 'Checking storage';
    }
    if (!usingSavedState) {
      return 'Manual setup';
    }
    return isReadyForInput ? 'Ready for objectives' : activeStageContent.title;
  }, [activeStageContent.title, isReadyForInput, snapshotStage, usingSavedState]);

  const objectiveHelper = useMemo(() => {
    if (isReadyForInput) {
      return 'Type an objective and press Enter or use the send button to execute it inside the agent.';
    }
    if (isCapturingSnapshot) {
      return 'Capturing the current Âme…';
    }
    if (isFetchingRemote) {
      return 'Downloading the Âme from remote storage…';
    }
    if (snapshotStage === 'importing') {
      return 'Importing the Âme into local storage…';
    }
    if (snapshotStage === 'checking') {
      return 'Looking for a stored Âme in your browser storage…';
    }
    if (snapshotStage === 'error') {
      return snapshotError
        ? `Snapshot error: ${snapshotError}`
        : 'Snapshot load failed. Use manual boot or import a new Âme.';
    }
    if (!usingSavedState) {
      return 'Import an Âme, fetch one remotely, or complete the manual install inside the VM.';
    }
    return 'The agent is restoring its last session. Objectives will unlock once the GUI is ready.';
  }, [
    isReadyForInput,
    isCapturingSnapshot,
    isFetchingRemote,
    snapshotError,
    snapshotStage,
    usingSavedState
  ]);

  const downloadEntries = useMemo(() => Object.entries(downloadState), [downloadState]);

  const snapshotStatusText = useMemo(() => {
    if (snapshotStage === 'ready') {
      if (snapshotSource && snapshotSource !== 'none') {
        return SNAPSHOT_SOURCE_LABEL[snapshotSource];
      }
      return 'Ready';
    }
    return SNAPSHOT_STAGE_LABEL[snapshotStage];
  }, [snapshotSource, snapshotStage]);

  const handleObjectiveFormSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!objectiveInputRef.current) {
      return;
    }
    const value = objectiveInputRef.current.value;
    handleObjectiveSubmit(value);
    objectiveInputRef.current.value = '';
  };

  const getStageState = useCallback(
    (stage: BootStage) => {
      if (!usingSavedState) {
        if (stage === 'idle') {
          return isReadyForInput ? 'complete' : 'active';
        }
        return 'upcoming';
      }
      const stageIndex = STAGE_ORDER.indexOf(stage);
      const currentIndex = STAGE_ORDER.indexOf(bootStage);
      if (stageIndex < currentIndex) {
        return 'complete';
      }
      if (stageIndex === currentIndex) {
        if (stage === 'done' && isReadyForInput) {
          return 'complete';
        }
        return 'active';
      }
      return 'upcoming';
    },
    [bootStage, isReadyForInput, usingSavedState]
  );

  const hintText = useMemo(() => {
    if (usingSavedState) {
      return activeStageContent.summary;
    }
    switch (snapshotStage) {
      case 'importing':
        return 'Importing the Âme into browser storage. Hang tight…';
      case 'checking':
        return 'Checking for an Âme in browser storage. You can also import one manually or fetch remotely.';
      case 'error':
        return 'Snapshot error detected. Retry the import or proceed with the manual installation.';
      default:
        return 'Use the VM window to complete the initial install. The sidebar explains each required step.';
    }
  }, [activeStageContent.summary, snapshotStage, usingSavedState]);

  const shouldShowOverlay = usingSavedState && !isReadyForInput;

  const renderSnapshotMeta = (record: StoredSnapshotRecord | null) => {
    if (!record) return null;
    return (
      <dl className="snapshot-meta">
        <div>
          <dt>File</dt>
          <dd>{record.name}</dd>
        </div>
        <div>
          <dt>Size</dt>
          <dd>{formatFileSize(record.size)}</dd>
        </div>
        <div>
          <dt>Stored</dt>
          <dd>{formatTimestamp(record.savedAt)}</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{snapshotSource && snapshotSource !== 'none' ? SNAPSHOT_SOURCE_LABEL[snapshotSource] : 'Unknown'}</dd>
        </div>
      </dl>
    );
  };

  return (
    <div className="app-shell">
      <div className="app-content">
        <header className="app-header">
          <div>
            <h1 className="app-title">Sovereign Agent Host</h1>
            <p className="app-subtitle">Nomadic intelligence workspace</p>
          </div>
          <div className={`status-pill status-pill--${statusPillState}`}>{statusPillLabel}</div>
        </header>

        <div className="app-body">
          <section className="emulator-section">
            <div className="emulator-frame">
              <Emulator
                key={instanceSeed}
                bootSeed={instanceSeed}
                ref={emulatorRef}
                initialState={usingSavedState ? initialState : undefined}
                onReady={handleEmulatorReady}
                onOutput={handleSerialOutput}
                onDownloadProgress={handleDownloadProgress}
                onDownloadError={handleDownloadError}
                onError={handleEmulatorError}
                className="emulator-surface"
              />
              {shouldShowOverlay && (
                <div className="emulator-overlay" aria-live="polite">
                  <div className="emulator-overlay__content">
                    <span className="loader" aria-hidden="true" />
                    <h2>{activeStageContent.title}</h2>
                    <p>{activeStageContent.summary}</p>
                  </div>
                </div>
              )}
            </div>
            <p className="emulator-hint">{hintText}</p>
          </section>

          <aside className="side-panel">
            <div className="info-card">
              <div className="info-card__header">
                <h2>System status</h2>
                <span className={`badge ${isReadyForInput ? 'badge--success' : 'badge--waiting'}`}>
                  {isReadyForInput ? 'Ready' : 'Booting'}
                </span>
              </div>
              <p className="info-card__status">{status}</p>
              <div className="info-card__meta">
                <div>
                  <span className="meta-label">Session source</span>
                  <span className="meta-value">
                    {usingSavedState ? 'Restored from saved Âme' : 'Live ISO (no Âme detected)'}
                  </span>
                </div>
                <div>
                  <span className="meta-label">Current phase</span>
                  <span className="meta-value">{activeStageContent.title}</span>
                </div>
                <div>
                  <span className="meta-label">Snapshot</span>
                  <span className="meta-value">{snapshotStatusText}</span>
                </div>
              </div>
            </div>

            <div className="info-card">
              <div className="info-card__header">
                <h2>Âme manager</h2>
                <span
                  className={`badge ${
                    snapshotStage === 'ready'
                      ? 'badge--success'
                      : snapshotStage === 'error'
                      ? 'badge--danger'
                      : 'badge--waiting'
                  }`}
                >
                  {SNAPSHOT_STAGE_LABEL[snapshotStage]}
                </span>
              </div>
              <p className="info-card__status">
                {snapshotStage === 'ready'
                  ? `Loaded ${snapshotMeta?.name ?? 'session.bin'}`
                  : snapshotStage === 'missing'
                  ? 'Import an Âme to enable automatic restores.'
                  : snapshotStage === 'importing'
                  ? 'Importing snapshot into local storage…'
                  : snapshotStage === 'checking'
                  ? 'Checking browser storage for a stored Âme…'
                  : snapshotError ?? 'Snapshot error. Manual boot is available.'}
              </p>
              {snapshotStage === 'ready' && renderSnapshotMeta(getSnapshotRecord())}
              {snapshotError && snapshotStage === 'error' && (
                <p className="info-card__error" role="alert">
                  {snapshotError}
                </p>
              )}
              <div className="snapshot-actions">
                <button
                  type="button"
                  className="control-button"
                  onClick={triggerSnapshotDialog}
                  disabled={snapshotStage === 'importing'}
                >
                  Import Âme
                </button>
                <button
                  type="button"
                  className="control-button"
                  onClick={handleCaptureSnapshot}
                  disabled={!isReadyForInput || isCapturingSnapshot}
                >
                  {isCapturingSnapshot ? 'Capturing…' : 'Capture Âme'}
                </button>
                <button
                  type="button"
                  className="control-button control-button--ghost"
                  onClick={handleDownloadSnapshot}
                  disabled={snapshotStage !== 'ready'}
                >
                  Download
                </button>
                <button
                  type="button"
                  className="control-button control-button--ghost"
                  onClick={handleForgetSnapshot}
                  disabled={snapshotStage !== 'ready'}
                >
                  Forget
                </button>
              </div>
              <form className="snapshot-remote" onSubmit={handleRemoteImport}>
                <input
                  type="url"
                  placeholder="https://…/agent.bin"
                  value={remoteUrl}
                  onChange={handleRemoteUrlChange}
                  disabled={isFetchingRemote}
                />
                <button type="submit" disabled={!remoteUrl.trim() || isFetchingRemote}>
                  {isFetchingRemote ? 'Fetching…' : 'Fetch'}
                </button>
              </form>
              {remoteError && <p className="info-card__error">{remoteError}</p>}
              {snapshotFeedback && <p className="info-card__note">{snapshotFeedback}</p>}
              <p className="snapshot-hint">
                Works with raw <code>.bin</code> snapshots exported from v86. Compressed <code>.zst</code> archives are not
                supported yet.
              </p>
              <input
                ref={snapshotInputRef}
                type="file"
                accept=".bin,application/octet-stream"
                onChange={handleSnapshotFileChange}
                hidden
              />
            </div>

            {downloadEntries.length > 0 && (
              <div className="info-card">
                <h2>Asset downloads</h2>
                <ul className="download-list">
                  {downloadEntries.map(([fileName, info]) => {
                    const label = normalizeResourceName(fileName);
                    const progressLabel =
                      info.error || !info.total || info.total <= 0
                        ? null
                        : `${Math.round((info.loaded / info.total) * 100)}%`;
                    return (
                      <li key={fileName} className="download-list__item">
                        <div className="download-list__name">{label}</div>
                        <div className="download-list__progress">
                          {info.error ? (
                            <span className="download-list__error">{info.error}</span>
                          ) : (
                            <>
                              <span>{progressLabel ?? formatFileSize(info.loaded)}</span>
                              {info.total && info.total > 0 && (
                                <span className="download-list__size">{formatFileSize(info.total)}</span>
                              )}
                            </>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {!usingSavedState && (
              <div className="info-card info-card--callout">
                <strong>Manual setup needed</strong>
                <p>
                  Follow the DSL desktop to install the agent. Once configured, capture the Âme to resume from this point
                  automatically next time.
                </p>
              </div>
            )}

            <ActionPlaybook
              actions={ACTION_PLAYBOOKS}
              isRunning={isActionRunning}
              activeActionId={activeActionId}
              disabled={!isReadyForInput}
              onRun={handleActionRun}
              onCopy={handleActionCopy}
            />
            {actionFeedback && <p className="info-card__note">{actionFeedback}</p>}
            {actionError && !actionFeedback && <p className="info-card__error">{actionError}</p>}

            <div className="info-card">
              <h2>Boot timeline</h2>
              <ul className="status-timeline">
                {STAGE_ORDER.map((stageKey) => {
                  const state = getStageState(stageKey);
                  const content = stageContent[stageKey];
                  return (
                    <li key={stageKey} className={`status-timeline__item status-timeline__item--${state}`}>
                      <span className="status-timeline__icon" aria-hidden="true" />
                      <div>
                        <div className="status-timeline__title">{content.title}</div>
                        <p className="status-timeline__description">{content.timelineSummary}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>

            <div className="info-card log-card">
              <div className="info-card__header">
                <h2>Serial console</h2>
              </div>
              <div className="log-card__viewport" ref={logViewportRef} aria-live="polite">
                <pre>{serialOutput.trim().length ? serialOutput : 'Waiting for serial output…'}</pre>
              </div>
            </div>
          </aside>
        </div>

        <footer className="app-footer">
          <form className="objective-form" onSubmit={handleObjectiveFormSubmit}>
            <input
              ref={objectiveInputRef}
              type="text"
              placeholder={isReadyForInput ? 'Enter an objective for the agent…' : 'Agent is preparing…'}
              disabled={!isReadyForInput}
            />
            <button type="submit" disabled={!isReadyForInput}>
              Send
            </button>
          </form>
          <p className="objective-helper">{objectiveHelper}</p>
          {objectiveFeedback && <p className="objective-feedback">{objectiveFeedback}</p>}
        </footer>
      </div>
    </div>
  );
};

export default App;
