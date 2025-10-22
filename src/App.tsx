import React, {
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
  ChangeEvent
} from 'react';
import { get, set, del } from 'idb-keyval';
import Emulator, {
  EmulatorRef,
  EmulatorDownloadEvent,
  EmulatorDownloadError
} from './components/Emulator';

type AgentState = ArrayBuffer | null;
type BootStage = 'idle' | 'waitingLogin' | 'waitingShell' | 'done';

type SnapshotStage = 'checking' | 'missing' | 'importing' | 'ready' | 'error';

type SnapshotSource = 'none' | 'stored' | 'uploaded';

type StoredSnapshotRecord = {
  buffer: ArrayBuffer;
  name?: string;
  size: number;
  savedAt: number;
};

const STAGE_ORDER: BootStage[] = ['idle', 'waitingLogin', 'waitingShell', 'done'];

type StageContent = {
  title: string;
  summary: string;
  timelineSummary: string;
};

const SNAPSHOT_STAGE_CONTENT: Record<BootStage, StageContent> = {
  idle: {
    title: 'Restoring agent state',
    summary: 'Rehydrating the saved Âme and preparing the VM display.',
    timelineSummary: 'Load saved memory snapshot'
  },
  waitingLogin: {
    title: 'Watching for login prompt',
    summary: 'Listening to the serial console to authenticate as root automatically.',
    timelineSummary: 'Detect login prompt'
  },
  waitingShell: {
    title: 'Preparing shell environment',
    summary: 'Opening a shell session and launching the graphical workspace.',
    timelineSummary: 'Log into shell'
  },
  done: {
    title: 'Launching agent GUI',
    summary: 'Starting the graphical environment so objectives can be executed.',
    timelineSummary: 'Start graphical agent'
  }
};

const MANUAL_STAGE_CONTENT: Record<BootStage, StageContent> = {
  idle: {
    title: 'First boot in progress',
    summary: 'No saved Âme detected. Use the VM to perform the initial setup.',
    timelineSummary: 'Boot DSL live ISO'
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
    title: 'Capture a snapshot',
    summary: 'Once configured, save the Âme to enable automatic resumes.',
    timelineSummary: 'Capture persistent state'
  }
};

const SNAPSHOT_DB_KEY = 'enigma-shell:snapshot';

const formatFileSize = (value: number | undefined) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return '—';
  }
  if (value === 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = value;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const precision = size >= 100 || units[unitIndex] === 'B' ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[unitIndex]}`;
};

const formatTimestamp = (timestamp: number | undefined) => {
  if (!timestamp || !Number.isFinite(timestamp)) {
    return '—';
  }
  try {
    return new Date(timestamp).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  } catch (error) {
    console.warn('Unable to format timestamp', error);
    return '—';
  }
};

const normalizeResourceName = (input: string) => {
  if (!input) {
    return 'resource';
  }
  const withoutQuery = input.split('?')[0];
  const withoutHash = withoutQuery.split('#')[0];
  const pathSegments = withoutHash.split('/').filter(Boolean);
  const candidate = pathSegments[pathSegments.length - 1];
  return candidate || withoutHash || 'resource';
};

function App() {
  const [status, setStatus] = useState('Checking for stored Âme…');
  const [isReadyForInput, setIsReadyForInput] = useState(false);
  const [serialOutput, setSerialOutput] = useState('');
  const [bootStage, setBootStage] = useState<BootStage>('idle');
  const [initialState, setInitialState] = useState<AgentState>(null);
  const [snapshotStage, setSnapshotStage] = useState<SnapshotStage>('checking');
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const [snapshotMeta, setSnapshotMeta] = useState<{
    name: string;
    size: number;
    savedAt: number;
  } | null>(null);
  const [snapshotSource, setSnapshotSource] = useState<SnapshotSource>('none');
  const [downloadState, setDownloadState] = useState<
    Record<
      string,
      {
        loaded: number;
        total?: number;
        error?: string;
      }
    >
  >({});
  const [emulatorKey, setEmulatorKey] = useState(0);

  const emulatorRef = useRef<EmulatorRef | null>(null);
  const logViewportRef = useRef<HTMLDivElement>(null);
  const objectiveInputRef = useRef<HTMLInputElement>(null);
  const snapshotInputRef = useRef<HTMLInputElement>(null);
  const hasBootstrapped = useRef(false);
  const bootStageRef = useRef<BootStage>('idle');

  const usingSavedState = snapshotStage === 'ready' && initialState !== null;

  useEffect(() => {
    let cancelled = false;

    const loadStoredSnapshot = async () => {
      try {
        setSnapshotError(null);
        const stored = await get<StoredSnapshotRecord | undefined>(SNAPSHOT_DB_KEY);
        if (cancelled) {
          return;
        }
        if (stored?.buffer) {
          setInitialState(stored.buffer);
          setSnapshotMeta({
            name: stored.name ?? 'session.bin',
            size: stored.size ?? stored.buffer.byteLength,
            savedAt: stored.savedAt ?? Date.now()
          });
          setSnapshotSource('stored');
          setSnapshotStage('ready');
          setStatus('Stored Âme found. Booting automatically…');
          setEmulatorKey((prev) => prev + 1);
        } else {
          setSnapshotSource('none');
          setSnapshotStage('missing');
          setStatus('No stored Âme detected. Manual boot is available.');
        }
      } catch (error) {
        console.error('Failed to load stored snapshot', error);
        if (!cancelled) {
          setSnapshotError((error as Error)?.message ?? 'Unable to access IndexedDB.');
          setSnapshotStage('error');
          setStatus('Snapshot storage error. Manual boot required.');
        }
      }
    };

    loadStoredSnapshot();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    hasBootstrapped.current = false;
    bootStageRef.current = 'idle';
    setBootStage('idle');
    setSerialOutput('');
    setIsReadyForInput(false);
    setDownloadState({});
  }, [emulatorKey]);

  const updateStage = useCallback((stage: BootStage) => {
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
    setStatus('Emulator ready. Waiting for prompts…');
    setIsReadyForInput(false);

    const emulator = emulatorRef.current;
    emulator?.runSerialCommand('');
  }, [updateStage, usingSavedState]);

  const handleSnapshotImport = useCallback(
    async (file: File) => {
      if (!file) {
        return;
      }
      setSnapshotError(null);
      const lowerName = file.name.toLowerCase();
      if (lowerName.endsWith('.zst')) {
        const message = 'Compressed snapshots (.zst) are not supported yet. Please decompress the file before importing.';
        setSnapshotStage('error');
        setSnapshotSource('none');
        setSnapshotError(message);
        setStatus('Snapshot import failed: compressed archives are not supported.');
        return;
      }

      setSnapshotStage('importing');
      setSnapshotSource('uploaded');
      setStatus('Importing Âme…');

      try {
        const buffer = await file.arrayBuffer();
        const record: StoredSnapshotRecord = {
          buffer,
          name: file.name,
          size: file.size,
          savedAt: Date.now()
        };
        await set(SNAPSHOT_DB_KEY, record);
        setInitialState(record.buffer);
        setSnapshotMeta({
          name: record.name ?? 'session.bin',
          size: record.size,
          savedAt: record.savedAt
        });
        setSnapshotStage('ready');
        setStatus('Âme imported successfully. Launching agent…');
        setEmulatorKey((prev) => prev + 1);
      } catch (error) {
        console.error('Failed to import snapshot', error);
        setSnapshotSource('none');
        setSnapshotError((error as Error)?.message ?? 'Unknown error while importing snapshot.');
        setSnapshotStage('error');
        setStatus('Snapshot import failed. Manual boot required.');
      }
    },
    []
  );

  const handleSnapshotFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) {
        void handleSnapshotImport(file);
      }
      event.target.value = '';
    },
    [handleSnapshotImport]
  );

  const triggerSnapshotDialog = useCallback(() => {
    snapshotInputRef.current?.click();
  }, []);

  const handleForgetSnapshot = useCallback(async () => {
    setSnapshotError(null);
    setSnapshotStage('checking');
    setStatus('Removing stored Âme…');
    try {
      await del(SNAPSHOT_DB_KEY);
    } catch (error) {
      console.error('Failed to remove stored snapshot', error);
    }
    setInitialState(null);
    setSnapshotMeta(null);
    setSnapshotSource('none');
    setSnapshotStage('missing');
    setStatus('Stored Âme removed. Manual boot is available.');
    setEmulatorKey((prev) => prev + 1);
  }, []);

  const handleObjectiveSubmit = useCallback(
    (objective: string) => {
      if (!isReadyForInput) return;
      const trimmed = objective.trim();
      if (!trimmed) return;
      console.log('New objective for VLM:', trimmed);
      setStatus(`Objective received: "${trimmed}"`);
      const emulator = emulatorRef.current;
      if (emulator) {
        emulator.runCommand(trimmed);
      }
    },
    [isReadyForInput]
  );

  const handleSerialOutput = useCallback((chunk: string) => {
    setSerialOutput((prev) => {
      const next = prev + chunk;
      return next.length > 4000 ? next.slice(-4000) : next;
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
      return 'Import an Âme or complete the manual install inside the VM to enable automation.';
    }
    return 'The agent is restoring its last session. Objectives will unlock once the GUI is ready.';
  }, [isReadyForInput, snapshotError, snapshotStage, usingSavedState]);

  const downloadEntries = useMemo(() => Object.entries(downloadState), [downloadState]);

  const snapshotStatusText = useMemo(() => {
    switch (snapshotStage) {
      case 'checking':
        return 'Checking storage';
      case 'importing':
        return 'Importing Âme';
      case 'ready':
        return snapshotSource === 'stored' ? 'Cached locally' : 'Imported now';
      case 'missing':
        return 'Not loaded';
      case 'error':
        return 'Error';
      default:
        return 'Unknown';
    }
  }, [snapshotSource, snapshotStage]);

  const handleObjectiveFormSubmit = (event: React.FormEvent<HTMLFormElement>) => {
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
        return 'Checking for an Âme in browser storage. You can also import one manually.';
      case 'error':
        return 'Snapshot error detected. Retry the import or proceed with the manual installation.';
      default:
        return 'Use the VM window to complete the initial install. The sidebar explains each required step.';
    }
  }, [activeStageContent.summary, snapshotStage, usingSavedState]);

  const shouldShowOverlay = usingSavedState && !isReadyForInput;

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
                key={emulatorKey}
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
                  {snapshotStage === 'ready'
                    ? 'Loaded'
                    : snapshotStage === 'error'
                    ? 'Error'
                    : snapshotStage === 'importing'
                    ? 'Importing'
                    : snapshotStage === 'checking'
                    ? 'Checking'
                    : 'Missing'}
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
              {snapshotMeta && snapshotStage === 'ready' && (
                <dl className="snapshot-meta">
                  <div>
                    <dt>File</dt>
                    <dd>{snapshotMeta.name}</dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{formatFileSize(snapshotMeta.size)}</dd>
                  </div>
                  <div>
                    <dt>Stored</dt>
                    <dd>{formatTimestamp(snapshotMeta.savedAt)}</dd>
                  </div>
                  <div>
                    <dt>Source</dt>
                    <dd>{snapshotSource === 'stored' ? 'Restored from cache' : 'Imported now'}</dd>
                  </div>
                </dl>
              )}
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
                  className="control-button control-button--ghost"
                  onClick={handleForgetSnapshot}
                  disabled={snapshotStage !== 'ready'}
                >
                  Forget
                </button>
              </div>
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
                  Follow the DSL desktop to install the agent. Once configured, capture the Âme to resume from
                  this point automatically next time.
                </p>
              </div>
            )}

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
        </footer>
      </div>
    </div>
  );
}

export default App;
