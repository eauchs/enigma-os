import React, {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import Emulator, {
  EmulatorRef,
  EmulatorDownloadEvent,
  EmulatorDownloadError
} from './components/Emulator';
import {
  agentProfiles,
  defaultAgentProfileId,
  AgentProfile,
  ManualStep,
  defaultStageContent
} from './config/agentProfiles';
import {
  ensureVaultMigrated,
  listSnapshots,
  loadSnapshotData,
  storeSnapshot,
  removeSnapshot,
  renameSnapshot,
  SnapshotMetadata,
  getStoredActiveSnapshotId,
  storeActiveSnapshotId
} from './services/snapshotVault';
import { BootStage, StageContent, BootStageContentSet, BOOT_STAGE_ORDER } from './types/boot';

type AgentState = ArrayBuffer | null;
type SnapshotStage = 'checking' | 'missing' | 'importing' | 'capturing' | 'ready' | 'error';
type SnapshotSource = 'none' | 'stored' | 'uploaded' | 'captured';
type StatusPillState = BootStage | 'ready' | 'manual' | 'error' | 'importing' | 'capturing';
type AssetStatusState = 'unknown' | 'available' | 'missing' | 'downloading' | 'error';

declare global {
  interface Window {
    __enigmaTestHarness?: {
      captureMock: (name?: string) => Promise<SnapshotMetadata>;
      renameMock: (id: string, name: string) => Promise<SnapshotMetadata | null>;
      listSnapshots: () => SnapshotMetadata[];
      renameByName: (currentName: string, nextName: string) => Promise<SnapshotMetadata | null>;
    };
  }
}

 interface AssetStatus {
   status: AssetStatusState;
   loaded?: number;
   total?: number;
   error?: string;
   size?: number;
 }

 const PROFILE_STORAGE_KEY = 'enigma-shell:profile';

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

 const getInitialProfileId = () => {
   if (typeof window !== 'undefined' && window.localStorage) {
     try {
       const stored = window.localStorage.getItem(PROFILE_STORAGE_KEY);
       if (stored && agentProfiles.some((profile) => profile.id === stored)) {
         return stored;
       }
     } catch (error) {
       console.warn('Unable to read stored profile id.', error);
     }
   }
   return defaultAgentProfileId;
 };

 const defaultStageSets = {
   snapshot: defaultStageContent.snapshot,
   manual: defaultStageContent.manual
 } satisfies { snapshot: BootStageContentSet; manual: BootStageContentSet };

 function App() {
   const [profileId, setProfileId] = useState<string>(() => getInitialProfileId());
   const [status, setStatus] = useState('Checking for stored Âme…');
   const [isReadyForInput, setIsReadyForInput] = useState(false);
   const [serialOutput, setSerialOutput] = useState('');
   const [bootStage, setBootStage] = useState<BootStage>('idle');
   const [initialState, setInitialState] = useState<AgentState>(null);
   const [snapshotStage, setSnapshotStage] = useState<SnapshotStage>('checking');
   const [snapshotError, setSnapshotError] = useState<string | null>(null);
   const [snapshotSource, setSnapshotSource] = useState<SnapshotSource>('none');
   const [availableSnapshots, setAvailableSnapshots] = useState<SnapshotMetadata[]>([]);
   const [activeSnapshotId, setActiveSnapshotId] = useState<string | null>(null);
   const [snapshotMeta, setSnapshotMeta] = useState<SnapshotMetadata | null>(null);
   const [downloadState, setDownloadState] = useState<
     Record<string, { loaded: number; total?: number; error?: string }>
   >({});
   const [assetStatusMap, setAssetStatusMap] = useState<Record<string, AssetStatus>>({});
   const [emulatorKey, setEmulatorKey] = useState(0);
   const [renamingSnapshotId, setRenamingSnapshotId] = useState<string | null>(null);
   const [renameDraft, setRenameDraft] = useState('');

   const emulatorRef = useRef<EmulatorRef | null>(null);
   const logViewportRef = useRef<HTMLDivElement>(null);
   const objectiveInputRef = useRef<HTMLInputElement>(null);
   const snapshotInputRef = useRef<HTMLInputElement>(null);
   const hasBootstrapped = useRef(false);
   const bootStageRef = useRef<BootStage>('idle');
   const pendingSnapshotSourceRef = useRef<SnapshotSource>('none');

   const activeProfile = useMemo<AgentProfile>(() => {
     return agentProfiles.find((profile) => profile.id === profileId) ?? agentProfiles[0];
   }, [profileId]);

   const stageSets = useMemo<{ snapshot: BootStageContentSet; manual: BootStageContentSet }>(() => ({
     snapshot: activeProfile.stageContent?.snapshot ?? defaultStageSets.snapshot,
     manual: activeProfile.stageContent?.manual ?? defaultStageSets.manual
   }), [activeProfile]);

   const automation = activeProfile.automation;
   const loginPromptsLower = useMemo(() => {
     const prompts = automation.loginPrompts && automation.loginPrompts.length ? automation.loginPrompts : ['login:'];
     return prompts.map((prompt) => prompt.toLowerCase());
   }, [automation]);
   const shellPromptsLower = useMemo(() => {
     const prompts = automation.shellPrompts && automation.shellPrompts.length ? automation.shellPrompts : ['# '];
     return prompts.map((prompt) => prompt.toLowerCase());
   }, [automation]);
   const loginCommand = automation.loginCommand ?? '';
   const guiCommand = automation.guiCommand ?? '';
   const readinessDelay = automation.readinessDelayMs ?? 4000;

   const manifestLookup = useMemo(() => {
     const map = new Map<string, string>();
     activeProfile.assetManifest.forEach((asset) => {
       map.set(asset.path, asset.path);
       map.set(normalizeResourceName(asset.path), asset.path);
     });
     return map;
   }, [activeProfile.assetManifest]);

   const profileSnapshots = useMemo(
     () =>
       availableSnapshots.filter(
         (snapshot) => !snapshot.profileId || snapshot.profileId === activeProfile.id
       ),
     [availableSnapshots, activeProfile.id]
   );

   const otherSnapshots = useMemo(
     () =>
       availableSnapshots.filter(
         (snapshot) => snapshot.profileId && snapshot.profileId !== activeProfile.id
       ),
     [availableSnapshots, activeProfile.id]
   );

   const usingSavedState = snapshotStage === 'ready' && initialState !== null;

   useEffect(() => {
     if (typeof window === 'undefined' || !window.localStorage) {
       return;
     }
     try {
       window.localStorage.setItem(PROFILE_STORAGE_KEY, activeProfile.id);
     } catch (error) {
       console.warn('Unable to persist profile id.', error);
     }
   }, [activeProfile.id]);

  useEffect(() => {
    let cancelled = false;

    const initialiseVault = async () => {
      try {
        await ensureVaultMigrated();
         const snapshots = await listSnapshots();
         if (cancelled) {
           return;
         }
         setAvailableSnapshots(snapshots);

         const storedActiveId = getStoredActiveSnapshotId();
         const matchingSnapshot = storedActiveId
           ? snapshots.find((snapshot) => snapshot.id === storedActiveId)
           : null;
         const preferredSnapshot = matchingSnapshot
           ? matchingSnapshot
           : snapshots.find(
               (snapshot) => !snapshot.profileId || snapshot.profileId === activeProfile.id
             ) ?? snapshots[0];

         if (preferredSnapshot) {
           pendingSnapshotSourceRef.current = 'stored';
           setActiveSnapshotId(preferredSnapshot.id);
           setSnapshotMeta(preferredSnapshot);
         } else {
           setSnapshotStage('missing');
           setSnapshotSource('none');
           setStatus(`No stored Âme detected for ${activeProfile.name}. Manual boot is available.`);
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

    void initialiseVault();

    return () => {
      cancelled = true;
    };
  }, [activeProfile.id, activeProfile.name]);

   useEffect(() => {
     if (!availableSnapshots.length) {
       return;
     }
     const current = availableSnapshots.find((snapshot) => snapshot.id === activeSnapshotId);
     if (current && (!current.profileId || current.profileId === activeProfile.id)) {
       return;
     }
     if (!current) {
       return;
     }
     const matching = availableSnapshots.find(
       (snapshot) => !snapshot.profileId || snapshot.profileId === activeProfile.id
     );
     if (matching) {
       pendingSnapshotSourceRef.current = 'stored';
       setActiveSnapshotId(matching.id);
       setSnapshotMeta(matching);
     }
   }, [availableSnapshots, activeProfile.id, activeSnapshotId]);

   useEffect(() => {
     storeActiveSnapshotId(activeSnapshotId);
   }, [activeSnapshotId]);

   useEffect(() => {
     hasBootstrapped.current = false;
     bootStageRef.current = 'idle';
     setBootStage('idle');
     setSerialOutput('');
     setIsReadyForInput(false);
     setDownloadState({});
   }, [emulatorKey]);

   useEffect(() => {
     let cancelled = false;

     if (!activeSnapshotId) {
       setInitialState(null);
       setSnapshotMeta(null);
       if (snapshotStage !== 'importing' && snapshotStage !== 'capturing') {
         setSnapshotStage('missing');
         setSnapshotSource('none');
         setStatus(`No stored Âme detected for ${activeProfile.name}. Manual boot is available.`);
       }
       return;
     }

     setSnapshotError(null);
     setSnapshotStage((prev) => (prev === 'importing' || prev === 'capturing' ? prev : 'checking'));
     setStatus('Loading selected Âme…');

     const loadSnapshot = async () => {
       try {
         const buffer = await loadSnapshotData(activeSnapshotId);
         if (cancelled) {
           return;
         }
         if (buffer) {
           setInitialState(buffer);
           const metadata =
             availableSnapshots.find((snapshot) => snapshot.id === activeSnapshotId) ?? null;
           setSnapshotMeta(metadata);
           const resolvedSource = pendingSnapshotSourceRef.current !== 'none'
             ? pendingSnapshotSourceRef.current
             : 'stored';
           pendingSnapshotSourceRef.current = 'none';
           setSnapshotSource(resolvedSource);
           setSnapshotStage('ready');
           setStatus('Stored Âme found. Booting automatically…');
           setEmulatorKey((previous) => previous + 1);
         } else {
           pendingSnapshotSourceRef.current = 'none';
           setSnapshotStage('missing');
           setSnapshotSource('none');
           setStatus('Selected Âme not found. Manual boot is available.');
         }
       } catch (error) {
         console.error('Failed to load snapshot', error);
         if (!cancelled) {
           pendingSnapshotSourceRef.current = 'none';
           setSnapshotStage('error');
           setSnapshotError((error as Error)?.message ?? 'Unknown error while loading snapshot.');
           setStatus('Snapshot load failed. Manual boot required.');
         }
       }
     };

     void loadSnapshot();

     return () => {
       cancelled = true;
     };
   }, [activeSnapshotId, availableSnapshots, snapshotStage, activeProfile.name]);

   useEffect(() => {
     let cancelled = false;
     setAssetStatusMap(() =>
       activeProfile.assetManifest.reduce<Record<string, AssetStatus>>((accumulator, asset) => {
         accumulator[asset.path] = { status: 'unknown' };
         return accumulator;
       }, {})
     );

     if (typeof window === 'undefined' || typeof window.fetch !== 'function') {
       return;
     }

     const controller = new AbortController();

     const probeAssets = async () => {
       await Promise.all(
         activeProfile.assetManifest.map(async (asset) => {
           try {
             const response = await fetch(asset.path, {
               method: 'HEAD',
               cache: 'no-cache',
               signal: controller.signal
             });
             if (!response.ok) {
               throw new Error(`HTTP ${response.status}`);
             }
             const sizeHeader = response.headers.get('content-length');
             const size = sizeHeader ? Number(sizeHeader) : undefined;
             if (cancelled) {
               return;
             }
             setAssetStatusMap((previous) => ({
               ...previous,
               [asset.path]: {
                 status: 'available',
                 size: Number.isFinite(size) ? Number(size) : previous[asset.path]?.size
               }
             }));
           } catch (error) {
             if (cancelled) {
               return;
             }
             const message = (error as Error)?.message ?? 'Asset check failed';
             setAssetStatusMap((previous) => ({
               ...previous,
               [asset.path]: {
                 status: 'missing',
                 error: message,
                 loaded: previous[asset.path]?.loaded,
                 total: previous[asset.path]?.total
               }
             }));
           }
         })
       );
     };

     void probeAssets();

     return () => {
       cancelled = true;
       controller.abort();
     };
   }, [activeProfile]);

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
       setStatus(
         `${activeProfile.name} is running without an Âme. Follow the manual checklist to finish booting.`
       );
       setIsReadyForInput(false);
       return;
     }

     updateStage('waitingLogin');
     setSerialOutput('');
     setStatus('Emulator ready. Waiting for prompts…');
     setIsReadyForInput(false);

     const emulator = emulatorRef.current;
     emulator?.runSerialCommand('');
   }, [activeProfile.name, updateStage, usingSavedState]);

   const handleSerialOutput = useCallback((chunk: string) => {
     setSerialOutput((previous) => {
       const next = previous + chunk;
       return next.length > 4000 ? next.slice(-4000) : next;
     });
   }, []);

   const handleDownloadProgress = useCallback(
     (event: EmulatorDownloadEvent) => {
       setDownloadState((previous) => ({
         ...previous,
         [event.fileName]: {
           loaded: event.loaded,
           total: event.lengthComputable ? event.total : undefined,
           error: undefined
         }
       }));

       const manifestKey =
         manifestLookup.get(event.fileName) ?? manifestLookup.get(normalizeResourceName(event.fileName));
       if (manifestKey) {
         setAssetStatusMap((previous) => ({
           ...previous,
           [manifestKey]: {
             status:
               event.lengthComputable && event.total && event.loaded >= event.total
                 ? 'available'
                 : 'downloading',
             loaded: event.loaded,
             total: event.lengthComputable ? event.total : previous[manifestKey]?.total,
             size:
               event.lengthComputable && event.total
                 ? event.total
                 : previous[manifestKey]?.size,
             error: undefined
           }
         }));
       }

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
     [isReadyForInput, manifestLookup]
   );

   const handleDownloadError = useCallback(
     (event: EmulatorDownloadError) => {
       setDownloadState((previous) => ({
         ...previous,
         [event.fileName]: {
           ...previous[event.fileName],
           error: event.status
             ? `HTTP ${event.status}${event.statusText ? ` ${event.statusText}` : ''}`
             : 'Download failed'
         }
       }));

       const manifestKey =
         manifestLookup.get(event.fileName) ?? manifestLookup.get(normalizeResourceName(event.fileName));
       if (manifestKey) {
         setAssetStatusMap((previous) => ({
           ...previous,
           [manifestKey]: {
             status: 'error',
             error: event.status
               ? `HTTP ${event.status}${event.statusText ? ` ${event.statusText}` : ''}`
               : 'Download failed',
             loaded: previous[manifestKey]?.loaded,
             total: previous[manifestKey]?.total,
             size: previous[manifestKey]?.size
           }
         }));
       }

       const resourceName = normalizeResourceName(event.fileName);
       setStatus(`Failed to download ${resourceName}. Ensure the asset is available in /public/images.`);
     },
     [manifestLookup]
   );

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
     const hasLoginPrompt = loginPromptsLower.some((prompt) => lower.includes(prompt));

     const promptIsClean = shellPromptsLower.some((prompt) => {
       const index = lower.lastIndexOf(prompt);
       if (index === -1) {
         return false;
       }
       const nextChar = lower[index + prompt.length];
       return index + prompt.length >= lower.length || nextChar === '\n' || nextChar === '\r';
     });

     if (stage === 'waitingLogin') {
       if (hasLoginPrompt && loginCommand) {
         setStatus(`Login prompt detected. Logging in as ${loginCommand}…`);
         emulator.runSerialCommand(loginCommand);
         updateStage('waitingShell');
         return;
       }
       if (promptIsClean && guiCommand) {
         setStatus('Shell prompt detected. Launching graphical workspace…');
         emulator.runKeyboardCommand(guiCommand);
         updateStage('done');
         setTimeout(() => {
           setStatus('Agent GUI is running. Ready for VLM control.');
           setIsReadyForInput(true);
         }, readinessDelay);
       }
     } else if (stage === 'waitingShell') {
       if (promptIsClean && guiCommand) {
         setStatus('Shell ready after login. Launching graphical workspace…');
         emulator.runKeyboardCommand(guiCommand);
         updateStage('done');
         setTimeout(() => {
           setStatus('Agent GUI is running. Ready for VLM control.');
           setIsReadyForInput(true);
         }, readinessDelay);
       }
     }
   }, [serialOutput, updateStage, usingSavedState, loginPromptsLower, shellPromptsLower, loginCommand, guiCommand, readinessDelay]);

   useEffect(() => {
     if (!usingSavedState) {
       return;
     }

     const stage = bootStageRef.current;
     if (!emulatorRef.current) {
       return;
     }
     if (stage === 'waitingLogin' && loginCommand) {
       const timer = window.setTimeout(() => {
         if (bootStageRef.current !== 'waitingLogin') {
           return;
         }
         setStatus(`No login prompt detected; sending ${loginCommand} manually…`);
         emulatorRef.current?.runSerialCommand(loginCommand);
         updateStage('waitingShell');
       }, 7000);
       return () => window.clearTimeout(timer);
     }
     if (stage === 'waitingShell' && guiCommand) {
       const timer = window.setTimeout(() => {
         if (bootStageRef.current !== 'waitingShell') {
           return;
         }
         setStatus('Shell prompt still not detected; launching GUI anyway…');
         emulatorRef.current?.runKeyboardCommand(guiCommand);
         updateStage('done');
         setTimeout(() => {
           setStatus('Agent GUI is running. Ready for VLM control.');
           setIsReadyForInput(true);
         }, readinessDelay);
       }, 6000);
       return () => window.clearTimeout(timer);
     }
     return;
   }, [bootStage, updateStage, usingSavedState, loginCommand, guiCommand, readinessDelay]);

   const handleSnapshotImport = useCallback(async (file: File) => {
     if (!file) {
       return;
     }
     setSnapshotError(null);
     const lowerName = file.name.toLowerCase();
     if (lowerName.endsWith('.zst')) {
       const message =
         'Compressed snapshots (.zst) are not supported yet. Please decompress the file before importing.';
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
       const metadata = await storeSnapshot({
         buffer,
         name: file.name,
         savedAt: Date.now(),
         profileId: activeProfile.id
       });
       pendingSnapshotSourceRef.current = 'uploaded';
       setAvailableSnapshots((previous) => {
         const filtered = previous.filter((snapshot) => snapshot.id !== metadata.id);
         return [metadata, ...filtered];
       });
       setSnapshotMeta(metadata);
       setActiveSnapshotId(metadata.id);
       setSnapshotError(null);
       setStatus('Âme imported successfully. Launching agent…');
     } catch (error) {
       console.error('Failed to import snapshot', error);
       setSnapshotSource('none');
       setSnapshotError((error as Error)?.message ?? 'Unknown error while importing snapshot.');
       setSnapshotStage('error');
       setStatus('Snapshot import failed. Manual boot required.');
     }
   }, [activeProfile.id]);

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

  const handleDeleteSnapshot = useCallback(
    async (id: string) => {
      if (!id) {
        return;
      }
       setStatus('Removing stored Âme…');
       try {
         await removeSnapshot(id);
         const filtered = availableSnapshots.filter((snapshot) => snapshot.id !== id);
         setAvailableSnapshots(filtered);
         if (activeSnapshotId === id) {
           const nextSnapshot = filtered.find(
             (snapshot) => !snapshot.profileId || snapshot.profileId === activeProfile.id
           ) ?? filtered[0];
          if (nextSnapshot) {
            pendingSnapshotSourceRef.current = 'stored';
            setActiveSnapshotId(nextSnapshot.id);
            setSnapshotMeta(nextSnapshot);
          } else {
            setActiveSnapshotId(null);
            setSnapshotMeta(null);
            setInitialState(null);
            pendingSnapshotSourceRef.current = 'none';
            setSnapshotStage('missing');
            setSnapshotSource('none');
            setStatus('Stored Âme removed. Manual boot is available.');
          }
        } else {
          setStatus('Stored Âme removed from the vault.');
        }
       } catch (error) {
         console.error('Failed to remove stored snapshot', error);
         setSnapshotError((error as Error)?.message ?? 'Unable to remove snapshot.');
       }
     },
    [activeSnapshotId, activeProfile.id, availableSnapshots]
  );

  const handleSelectSnapshot = useCallback((snapshot: SnapshotMetadata) => {
    pendingSnapshotSourceRef.current = 'stored';
    setSnapshotStage((previous) =>
      previous === 'capturing' || previous === 'importing' ? previous : 'checking'
    );
    setActiveSnapshotId(snapshot.id);
    setSnapshotMeta(snapshot);
    setStatus(`Switching to Âme ${snapshot.name}…`);
  }, []);

   const beginRenameSnapshot = useCallback((snapshot: SnapshotMetadata) => {
     setRenamingSnapshotId(snapshot.id);
     setRenameDraft(snapshot.name);
   }, []);

   const cancelRenameSnapshot = useCallback(() => {
     setRenamingSnapshotId(null);
     setRenameDraft('');
   }, []);

   const confirmRenameSnapshot = useCallback(async () => {
     if (!renamingSnapshotId) {
       return;
     }
     const trimmed = renameDraft.trim();
     if (!trimmed) {
       return;
     }
     try {
       const updated = await renameSnapshot(renamingSnapshotId, trimmed);
       if (!updated) {
         return;
       }
       setAvailableSnapshots((previous) =>
         previous.map((snapshot) => (snapshot.id === updated.id ? { ...snapshot, name: updated.name } : snapshot))
       );
       if (snapshotMeta?.id === updated.id) {
         setSnapshotMeta({ ...snapshotMeta, name: updated.name });
       }
       cancelRenameSnapshot();
     } catch (error) {
       console.error('Failed to rename snapshot', error);
       setSnapshotError((error as Error)?.message ?? 'Unable to rename snapshot.');
     }
   }, [cancelRenameSnapshot, renameDraft, renamingSnapshotId, snapshotMeta]);

   const handleRenameKeyDown = useCallback(
     (event: React.KeyboardEvent<HTMLInputElement>) => {
       if (event.key === 'Enter') {
         event.preventDefault();
         void confirmRenameSnapshot();
       } else if (event.key === 'Escape') {
         event.preventDefault();
         cancelRenameSnapshot();
       }
     },
     [cancelRenameSnapshot, confirmRenameSnapshot]
   );

   const handleExportSnapshot = useCallback(async (snapshot: SnapshotMetadata) => {
     try {
       const buffer = await loadSnapshotData(snapshot.id);
       if (!buffer) {
         throw new Error('Snapshot payload is empty.');
       }
       const blob = new Blob([buffer], { type: 'application/octet-stream' });
       const extension = snapshot.name.toLowerCase().endsWith('.bin') ? '' : '.bin';
       const link = document.createElement('a');
       link.href = URL.createObjectURL(blob);
       link.download = `${snapshot.name}${extension}`;
       document.body.appendChild(link);
       link.click();
       document.body.removeChild(link);
       URL.revokeObjectURL(link.href);
     } catch (error) {
       console.error('Failed to export snapshot', error);
       setSnapshotError((error as Error)?.message ?? 'Unable to export snapshot.');
     }
   }, []);

  const handleCaptureSnapshot = useCallback(async () => {
    const emulator = emulatorRef.current;
    if (!emulator) {
      setStatus('Emulator is not ready to capture an Âme yet.');
      return;
    }
    setSnapshotError(null);
    setSnapshotStage('capturing');
    setStatus('Capturing Âme from running VM…');
    try {
      const buffer = await emulator.saveState();
       if (!buffer) {
         throw new Error('The emulator did not return any snapshot data.');
       }
       const metadata = await storeSnapshot({
         buffer,
         name: `Captured-${new Date().toISOString().replace(/[:.]/g, '-')}.bin`,
         savedAt: Date.now(),
         profileId: activeProfile.id
       });
       pendingSnapshotSourceRef.current = 'captured';
       setAvailableSnapshots((previous) => {
         const filtered = previous.filter((snapshot) => snapshot.id !== metadata.id);
         return [metadata, ...filtered];
       });
       setSnapshotMeta(metadata);
       setActiveSnapshotId(metadata.id);
      setStatus('Âme captured. Restarting the agent…');
    } catch (error) {
      console.error('Failed to capture snapshot', error);
      pendingSnapshotSourceRef.current = 'none';
      setSnapshotStage('error');
      setSnapshotSource('none');
      setSnapshotError((error as Error)?.message ?? 'Unable to capture snapshot.');
      setStatus('Snapshot capture failed. The current session continues running.');
    }
  }, [activeProfile.id]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    if (import.meta.env.PROD) {
      if (window.__enigmaTestHarness) {
        delete window.__enigmaTestHarness;
      }
      return;
    }

    const renameById = async (id: string, name: string) => {
      const metadata = await renameSnapshot(id, name);
      if (!metadata) {
        return null;
      }
      setAvailableSnapshots((previous) =>
        previous.map((snapshot) => (snapshot.id === metadata.id ? metadata : snapshot))
      );
      setSnapshotMeta((previous) => (previous && previous.id === metadata.id ? metadata : previous));
      setStatus('Âme renamed via test harness.');
      return metadata;
    };

    const harness = {
      captureMock: async (name?: string) => {
        const buffer = new ArrayBuffer(4);
        const metadata = await storeSnapshot({
          buffer,
          name: name?.trim() || `Captured-${new Date().toISOString().replace(/[:.]/g, '-')}.bin`,
          savedAt: Date.now(),
          profileId: activeProfile.id
        });
        pendingSnapshotSourceRef.current = 'captured';
        setAvailableSnapshots((previous) => {
          const filtered = previous.filter((snapshot) => snapshot.id !== metadata.id);
          return [metadata, ...filtered];
        });
        setSnapshotMeta(metadata);
        setActiveSnapshotId(metadata.id);
        setSnapshotStage('ready');
        setStatus('Âme captured via test harness.');
        return metadata;
      },
      renameMock: renameById,
      listSnapshots: () => [...availableSnapshots],
      renameByName: async (currentName: string, nextName: string) => {
        const target = availableSnapshots.find((snapshot) => snapshot.name === currentName);
        if (!target) {
          return null;
        }
        return renameById(target.id, nextName);
      }
    } as const;

    window.__enigmaTestHarness = harness;

    return () => {
      if (window.__enigmaTestHarness === harness) {
        delete window.__enigmaTestHarness;
      }
    };
  }, [activeProfile.id, availableSnapshots]);

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

   const downloadEntries = useMemo(() => Object.entries(downloadState), [downloadState]);

   const handleObjectiveFormSubmit = useCallback(
     (event: React.FormEvent) => {
       event.preventDefault();
       if (!objectiveInputRef.current) return;
       const value = objectiveInputRef.current.value;
       if (!value.trim()) return;
       handleObjectiveSubmit(value);
       objectiveInputRef.current.value = '';
     },
     [handleObjectiveSubmit]
   );

   const stageContent = useMemo<Record<BootStage, StageContent>>(
     () => (usingSavedState ? stageSets.snapshot : stageSets.manual),
     [stageSets, usingSavedState]
   );

   const activeStageContent = stageContent[bootStage];

   const statusPillState = useMemo<StatusPillState>(() => {
     if (snapshotStage === 'error') {
       return 'error';
     }
     if (snapshotStage === 'capturing') {
       return 'capturing';
     }
     if (snapshotStage === 'importing' || snapshotStage === 'checking') {
       return 'importing';
     }
     if (!usingSavedState) {
       return 'manual';
     }
     if (isReadyForInput) {
       return 'ready';
     }
     return bootStage;
   }, [bootStage, isReadyForInput, snapshotStage, usingSavedState]);

   const statusPillLabel = useMemo(() => {
     switch (statusPillState) {
       case 'error':
         return 'Snapshot error';
       case 'capturing':
         return 'Capturing Âme';
       case 'importing':
         return snapshotStage === 'checking' ? 'Checking vault' : 'Importing Âme';
       case 'manual':
         return 'Manual boot';
       case 'ready':
         return 'Agent ready';
       case 'idle':
         return 'Restoring';
       case 'waitingLogin':
         return 'Awaiting login';
       case 'waitingShell':
         return 'Preparing shell';
       case 'done':
         return 'Launching GUI';
       default:
         return 'Status';
     }
   }, [statusPillState, snapshotStage]);

   const statusPillSummary = useMemo(() => {
     switch (statusPillState) {
       case 'error':
         return snapshotError ?? 'The Âme vault is unreachable.';
       case 'capturing':
         return 'Saving the live VM state into the Âme vault…';
       case 'importing':
         return snapshotStage === 'checking'
           ? 'Looking for stored Âmes in the browser vault.'
           : 'Importing snapshot into the local vault…';
       case 'manual':
         return 'Follow the manual boot checklist inside the VM.';
       case 'ready':
         return 'The sovereign agent workspace is ready for objectives.';
       default:
         return activeStageContent.summary;
     }
   }, [activeStageContent.summary, snapshotError, snapshotStage, statusPillState]);

   const snapshotStatusText = useMemo(() => {
     if (snapshotStage === 'ready' && snapshotMeta) {
       return `${snapshotMeta.name} · ${formatFileSize(snapshotMeta.size)}`;
     }
     if (snapshotStage === 'missing') {
       return profileSnapshots.length
         ? 'Select an Âme from the vault to resume automatically.'
         : 'No Âme cached for this profile.';
     }
     if (snapshotStage === 'capturing') {
       return 'Capturing current VM state…';
     }
     if (snapshotStage === 'importing') {
       return 'Importing Âme…';
     }
     if (snapshotStage === 'checking') {
       return 'Checking vault…';
     }
     if (snapshotStage === 'error') {
       return snapshotError ?? 'Snapshot error. Manual boot is available.';
     }
     return '—';
   }, [profileSnapshots.length, snapshotError, snapshotMeta, snapshotStage]);

   const objectiveHelper = useMemo(() => {
     if (snapshotStage === 'importing' || snapshotStage === 'capturing' || snapshotStage === 'checking') {
       return 'Hold tight while the Âme vault operation completes.';
     }
     if (!usingSavedState) {
       return activeProfile.manualSteps.length
         ? 'Boot manually using the checklist, then capture an Âme to automate future resumes.'
         : 'Boot the VM manually, configure your agent, and capture an Âme when ready.';
     }
     if (!isReadyForInput) {
       return activeStageContent.summary;
     }
     return 'Décrivez un objectif : le VLM rejouera des actions clavier/souris dans la VM pour l’accomplir.';
   }, [activeProfile.manualSteps.length, activeStageContent.summary, isReadyForInput, snapshotStage, usingSavedState]);

   const handleProfileChange = useCallback((event: ChangeEvent<HTMLSelectElement>) => {
     const nextId = event.target.value;
     if (nextId !== profileId) {
       setProfileId(nextId);
       setStatus(`Switched to profile ${agentProfiles.find((profile) => profile.id === nextId)?.name ?? nextId}.`);
     }
   }, [profileId]);

   return (
     <div className="app-shell">
       <div className="app">
         <header className="app__header">
           <div>
             <h1>Enigma Shell</h1>
             <p className="app__subtitle">{activeProfile.tagline}</p>
           </div>
           <div className="status-pill status-pill--${statusPillState}">
             <span className="status-pill__label">{statusPillLabel}</span>
             <span className="status-pill__summary">{statusPillSummary}</span>
           </div>
         </header>

         <div className="app__body">
           <main className="app__main">
             <div className="emulator-frame">
               <div className="emulator-frame__header">
                 <div>
                   <h2>{activeProfile.name}</h2>
                   <p>{status}</p>
                 </div>
                 <div className="profile-selector">
                   <label htmlFor="profile-select">Profile</label>
                   <select id="profile-select" value={profileId} onChange={handleProfileChange}>
                     {agentProfiles.map((profile) => (
                       <option key={profile.id} value={profile.id}>
                         {profile.name}
                       </option>
                     ))}
                   </select>
                 </div>
               </div>
               <Emulator
                 key={emulatorKey}
                 ref={emulatorRef}
                 initialState={initialState}
                 onReady={handleEmulatorReady}
                 onOutput={handleSerialOutput}
                 onDownloadProgress={handleDownloadProgress}
                 onDownloadError={handleDownloadError}
                 onError={handleEmulatorError}
                 className={usingSavedState ? 'emulator--restored' : 'emulator--fresh'}
                 emulatorConfig={activeProfile.emulator}
               />
             </div>
           </main>

           <aside className="app__sidebar">
             <div className="info-card">
               <div className="info-card__header">
                 <h2>Current state</h2>
               </div>
               <p className="info-card__status">{snapshotStatusText}</p>
               <div className="status-grid">
                 <div>
                   <span className="meta-label">Current phase</span>
                   <span className="meta-value">{activeStageContent.title}</span>
                 </div>
                 <div>
                   <span className="meta-label">Snapshot source</span>
                   <span className="meta-value">
                     {snapshotStage === 'ready'
                       ? snapshotSource === 'uploaded'
                         ? 'Imported now'
                         : snapshotSource === 'captured'
                         ? 'Captured locally'
                         : 'Restored from vault'
                       : '—'}
                   </span>
                 </div>
               </div>
             </div>

             <div className="info-card profile-card">
               <div className="info-card__header">
                 <h2>Profile overview</h2>
               </div>
               <p>{activeProfile.description}</p>
               {activeProfile.snapshotHint && (
                 <p className="profile-card__hint">{activeProfile.snapshotHint}</p>
               )}
             </div>

             <div className="info-card snapshot-card">
               <div className="info-card__header">
                 <h2>Âme vault</h2>
                 <span
                   className={`badge ${
                     snapshotStage === 'ready'
                       ? 'badge--success'
                       : snapshotStage === 'error'
                       ? 'badge--danger'
                       : snapshotStage === 'importing' || snapshotStage === 'capturing'
                       ? 'badge--waiting'
                       : 'badge--neutral'
                   }`}
                 >
                   {snapshotStage === 'ready'
                     ? 'Ready'
                     : snapshotStage === 'error'
                     ? 'Error'
                     : snapshotStage === 'importing'
                     ? 'Importing'
                     : snapshotStage === 'capturing'
                     ? 'Capturing'
                     : snapshotStage === 'checking'
                     ? 'Checking'
                     : 'Missing'}
                 </span>
               </div>
               <div className="snapshot-vault">
                 {profileSnapshots.length === 0 && otherSnapshots.length === 0 ? (
                   <p className="snapshot-vault__empty">No Âme stored yet. Import or capture one to enable instant resumes.</p>
                 ) : (
                   <ul>
                     {profileSnapshots.map((snapshot) => {
                       const isActive = snapshot.id === activeSnapshotId;
                       const isRenaming = renamingSnapshotId === snapshot.id;
                       return (
                         <li
                           key={snapshot.id}
                           className={`snapshot-vault__item ${isActive ? 'snapshot-vault__item--active' : ''}`}
                         >
                           <div className="snapshot-vault__main">
                             {isRenaming ? (
                               <input
                                 autoFocus
                                 value={renameDraft}
                                 onChange={(event) => setRenameDraft(event.target.value)}
                                 onKeyDown={handleRenameKeyDown}
                               />
                             ) : (
                              <button type="button" onClick={() => handleSelectSnapshot(snapshot)}>
                                <span className="snapshot-vault__name">{snapshot.name}</span>
                                <span className="snapshot-vault__meta">
                                  {formatFileSize(snapshot.size)} · {formatTimestamp(snapshot.savedAt)}
                                </span>
                               </button>
                             )}
                           </div>
                           <div className="snapshot-vault__actions">
                             {isRenaming ? (
                               <>
                                 <button type="button" onClick={() => void confirmRenameSnapshot()}>Save</button>
                                 <button type="button" onClick={cancelRenameSnapshot}>Cancel</button>
                               </>
                             ) : (
                               <>
                                 <button type="button" onClick={() => beginRenameSnapshot(snapshot)}>Rename</button>
                                 <button type="button" onClick={() => void handleExportSnapshot(snapshot)}>
                                   Export
                                 </button>
                                 <button type="button" onClick={() => void handleDeleteSnapshot(snapshot.id)}>
                                   Delete
                                 </button>
                               </>
                             )}
                           </div>
                         </li>
                       );
                     })}
                     {otherSnapshots.length > 0 && (
                       <li className="snapshot-vault__other">
                         <span>Snapshots from other profiles</span>
                         <ul>
                           {otherSnapshots.map((snapshot) => (
                             <li key={snapshot.id}>
                               <button type="button" onClick={() => handleSelectSnapshot(snapshot)}>
                                 {snapshot.name} · {snapshot.profileId}
                               </button>
                             </li>
                           ))}
                         </ul>
                       </li>
                     )}
                   </ul>
                 )}
               </div>
               <div className="snapshot-actions">
                 <button
                   type="button"
                   className="control-button"
                   onClick={triggerSnapshotDialog}
                   disabled={snapshotStage === 'importing' || snapshotStage === 'capturing'}
                 >
                   Import Âme
                 </button>
                 <button
                   type="button"
                   className="control-button"
                   onClick={() => void handleCaptureSnapshot()}
                   disabled={snapshotStage === 'importing' || snapshotStage === 'capturing'}
                 >
                   Capture from VM
                 </button>
               </div>
              <input
                ref={snapshotInputRef}
                type="file"
                accept=".bin,application/octet-stream"
                onChange={handleSnapshotFileChange}
                data-testid="snapshot-file-input"
                hidden
              />
             </div>

             <div className="info-card asset-card">
               <div className="info-card__header">
                 <h2>Profile assets</h2>
               </div>
               <ul className="asset-manifest">
                 {activeProfile.assetManifest.map((asset) => {
                   const status = assetStatusMap[asset.path] ?? { status: 'unknown' };
                   const statusLabel =
                     status.status === 'available'
                       ? 'Available'
                       : status.status === 'missing'
                       ? 'Missing'
                       : status.status === 'downloading'
                       ? 'Downloading'
                       : status.status === 'error'
                       ? 'Error'
                       : 'Unknown';
                   return (
                     <li key={asset.path} className={`asset-manifest__item asset-manifest__item--${status.status}`}>
                       <div>
                         <span className="asset-manifest__name">{asset.label}</span>
                         {asset.description && <p className="asset-manifest__description">{asset.description}</p>}
                         {asset.optional && <span className="asset-manifest__optional">Optional</span>}
                       </div>
                       <div className="asset-manifest__status">
                         <span>{statusLabel}</span>
                         {status.size && <span>{formatFileSize(status.size)}</span>}
                         {status.loaded && status.total && status.status === 'downloading' && (
                           <span>
                             {formatFileSize(status.loaded)} / {formatFileSize(status.total)}
                           </span>
                         )}
                         {status.error && <span className="asset-manifest__error">{status.error}</span>}
                       </div>
                     </li>
                   );
                 })}
               </ul>
               {downloadEntries.length > 0 && (
                 <div className="asset-downloads">
                   <h3>Active downloads</h3>
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
             </div>

             {activeProfile.manualSteps.length > 0 && (
               <div className="info-card manual-card">
                 <div className="info-card__header">
                   <h2>Manual boot checklist</h2>
                   {!usingSavedState && <span className="badge badge--warning">In progress</span>}
                 </div>
                 <ol className="manual-steps">
                   {activeProfile.manualSteps.map((step: ManualStep, index: number) => (
                     <li key={`${step.title}-${index}`}>
                       <span className="manual-steps__index">{index + 1}</span>
                       <div>
                         <span className="manual-steps__title">{step.title}</span>
                         <p>{step.description}</p>
                         {step.command && <code>{step.command}</code>}
                       </div>
                     </li>
                   ))}
                 </ol>
               </div>
             )}

             <div className="info-card">
               <h2>Boot timeline</h2>
               <ul className="status-timeline">
                 {BOOT_STAGE_ORDER.map((stageKey) => {
                    const state = (() => {
                      if (statusPillState === 'error') {
                        return 'error';
                      }
                      if (!usingSavedState) {
                        return bootStage === stageKey ? 'active' : 'pending';
                      }
                      if (bootStage === stageKey) {
                        return 'active';
                      }
                      const stageIndex = BOOT_STAGE_ORDER.indexOf(stageKey);
                      const currentIndex = BOOT_STAGE_ORDER.indexOf(bootStage);
                      return stageIndex < currentIndex ? 'complete' : 'pending';
                    })();
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
