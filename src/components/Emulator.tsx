import React, { forwardRef, useImperativeHandle, useRef, useEffect, useMemo } from 'react';

// On définit les types pour que TypeScript comprenne ce que notre composant peut faire
export interface EmulatorRef {
  serial0_send: (cmd: string) => void;
  keyboardType: (text: string) => void;
  runCommand: (command: string) => void;
  runSerialCommand: (command: string) => void;
  runKeyboardCommand: (command: string) => void;
  saveState: () => Promise<ArrayBuffer | null>;
}

export interface EmulatorBootDisk {
  url: string;
  async?: boolean;
}

export interface EmulatorBootConfig {
  wasmPath?: string;
  bios?: { url: string };
  vgaBios?: { url: string };
  memorySize?: number;
  hda?: EmulatorBootDisk | false;
  cdrom?: EmulatorBootDisk | false;
  bootOrder?: number;
  extraConfig?: Record<string, unknown>;
}

export interface EmulatorDownloadEvent {
  fileName: string;
  loaded: number;
  total?: number;
  lengthComputable: boolean;
}

export interface EmulatorDownloadError {
  fileName: string;
  status?: number;
  statusText?: string;
}

interface V86Instance {
  add_listener: (event: string, callback: (...args: unknown[]) => void) => void;
  serial0_send?: (text: string) => void;
  keyboard_send_text?: (text: string) => void;
  save_state?: () => Promise<ArrayBuffer>;
  destroy?: () => void;
}

type V86StarterConstructor = new (config: Record<string, unknown>) => V86Instance;

interface EmulatorProps {
  initialState?: ArrayBuffer | null;
  onReady?: () => void;
  onOutput?: (chunk: string) => void;
  onDownloadProgress?: (event: EmulatorDownloadEvent) => void;
  onDownloadError?: (event: EmulatorDownloadError) => void;
  onError?: (error: Error) => void;
  emulatorConfig?: EmulatorBootConfig;
  className?: string;
}

// Déclaration globale pour que TypeScript connaisse V86Starter
declare global {
  interface Window {
    V86Starter?: V86StarterConstructor;
    V86?: V86StarterConstructor;
  }
}

// On type les props et la ref
const Emulator = forwardRef<EmulatorRef, EmulatorProps>(
  (
    {
      initialState,
      onReady,
      onOutput,
      onDownloadProgress,
      onDownloadError,
      onError,
      emulatorConfig,
      className
    },
    ref
  ) => {
  const screenContainerRef = useRef<HTMLDivElement>(null);
  const emulatorInstance = useRef<V86Instance | null>(null);
  const latestOnReady = useRef(onReady);
  const latestOnOutput = useRef(onOutput);
  const latestOnDownloadProgress = useRef(onDownloadProgress);
  const latestOnDownloadError = useRef(onDownloadError);
  const latestOnError = useRef(onError);
  const hasAnnouncedReady = useRef(false);
  const lineBufferRef = useRef<string>('');

  useEffect(() => {
    latestOnReady.current = onReady;
  }, [onReady]);

  useEffect(() => {
    latestOnOutput.current = onOutput;
  }, [onOutput]);

  useEffect(() => {
    latestOnDownloadProgress.current = onDownloadProgress;
  }, [onDownloadProgress]);

  useEffect(() => {
    latestOnDownloadError.current = onDownloadError;
  }, [onDownloadError]);

  useEffect(() => {
    latestOnError.current = onError;
  }, [onError]);

  useEffect(() => {
    let isDisposed = false;
    let retryTimer: number | null = null;

    let scriptElement: HTMLScriptElement | null = null;
    let handleScriptLoad: (() => void) | null = null;
    let handleScriptError: ((event: Event) => void) | null = null;

    const cleanupScriptListeners = () => {
      if (!scriptElement) return;
      if (handleScriptLoad) {
        scriptElement.removeEventListener('load', handleScriptLoad);
      }
      if (handleScriptError) {
        scriptElement.removeEventListener('error', handleScriptError);
      }
      handleScriptLoad = null;
      handleScriptError = null;
    };

    const ensureV86Script = () =>
      new Promise<void>((resolve, reject) => {
        if (window.V86Starter) {
          resolve();
          return;
        }

        scriptElement =
          document.querySelector<HTMLScriptElement>('script[data-v86-script]') ?? null;

        const onLoad = () => {
          cleanupScriptListeners();
          scriptElement?.setAttribute('data-v86-loaded', 'true');
          resolve();
        };

        const onError = (event: Event) => {
          cleanupScriptListeners();
          reject(new Error(`Unable to load /v86/libv86.js (${event.type})`));
        };

        handleScriptLoad = onLoad;
        handleScriptError = onError;

        if (scriptElement) {
          scriptElement.addEventListener('load', onLoad, { once: true });
          scriptElement.addEventListener('error', onError, { once: true });

          // Si le script est déjà chargé mais que window.V86Starter n'est pas encore prêt, on retente au prochain tick
          if (scriptElement.getAttribute('data-v86-loaded') === 'true') {
            queueMicrotask(() => resolve());
          }
          return;
        }

        scriptElement = document.createElement('script');
        scriptElement.src = '/v86/libv86.js';
        scriptElement.async = true;
        scriptElement.dataset.v86Script = 'true';
        scriptElement.addEventListener('load', onLoad, { once: true });
        scriptElement.addEventListener('error', onError, { once: true });
        document.head.appendChild(scriptElement);
      });

    const initializeEmulator = () => {
      if (isDisposed) return;
      if (!window.V86Starter && window.V86) {
        window.V86Starter = window.V86;
      }

      if (!window.V86Starter || !screenContainerRef.current) {
        retryTimer = window.setTimeout(initializeEmulator, 100);
        return;
      }

      if (emulatorInstance.current) {
        return;
      }

      const resolvedMemory = (emulatorConfig?.memorySize ?? 768) * 1024 * 1024;
      const config: Record<string, unknown> = {
        screen_container: screenContainerRef.current,
        keyboard_element: screenContainerRef.current,
        wasm_path: emulatorConfig?.wasmPath ?? '/v86/v86.wasm',
        bios: emulatorConfig?.bios ?? { url: '/v86/seabios.bin' },
        vga_bios: emulatorConfig?.vgaBios ?? { url: '/v86/vgabios.bin' },
        memory_size: resolvedMemory,
        preserve_mac_from_state_image: true,
        uart_output_all: true,
        autostart: true
      };

      const resolvedHda = emulatorConfig?.hda === false ? null : emulatorConfig?.hda ?? { url: '/images/dsl_disk.img', async: false };
      if (resolvedHda) {
        config.hda = resolvedHda;
      }

      if (initialState) {
        console.log('Restoring agent from saved Âme...');
        config.initial_state = initialState;
      } else {
        console.log('First boot detected. Loading base media.');
        const resolvedCdrom = emulatorConfig?.cdrom === false ? null : emulatorConfig?.cdrom ?? {
          url: '/images/dsl-2024.rc7.iso',
          async: false
        };
        if (resolvedCdrom) {
          config.cdrom = resolvedCdrom;
        }
        if (typeof emulatorConfig?.bootOrder === 'number') {
          config.boot_order = emulatorConfig.bootOrder;
        } else if (resolvedCdrom) {
          config.boot_order = 0x132;
        }
      }

      if (initialState && typeof emulatorConfig?.bootOrder === 'number') {
        config.boot_order = emulatorConfig.bootOrder;
      }

      if (emulatorConfig?.extraConfig && typeof emulatorConfig.extraConfig === 'object') {
        Object.assign(config, emulatorConfig.extraConfig);
      }

      let instance: V86Instance | null = null;
      try {
        instance = new window.V86Starter(config);
      } catch (error) {
        console.error('Failed to start the v86 emulator.', error);
        const errorCallback = latestOnError.current;
        if (errorCallback) {
          errorCallback(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }
      emulatorInstance.current = instance;
      hasAnnouncedReady.current = false;
      lineBufferRef.current = '';

      instance.add_listener('emulator-ready', () => {
        console.log("Emulator is technically ready.");
        screenContainerRef.current?.focus();
        const readyCb = latestOnReady.current;
        if (readyCb && !hasAnnouncedReady.current) {
          hasAnnouncedReady.current = true;
          readyCb();
        }
      });

      instance.add_listener('serial0-output-byte', (charCode: number) => {
        const char = String.fromCharCode(charCode);
        const latestOutput = latestOnOutput.current;
        if (char === '\r') {
          return;
        }

        if (char === '\n') {
          const line = `${lineBufferRef.current}\n`;
          if (latestOutput) {
            latestOutput(line);
          }
          console.log(`[serial0] ${line.trimEnd()}`);
          // Keep optional login detection for serial-based snapshots
          if (!hasAnnouncedReady.current && lineBufferRef.current.toLowerCase().includes('login:')) {
            hasAnnouncedReady.current = true;
            const readyCb = latestOnReady.current;
            if (readyCb) {
              readyCb();
            }
          }
          lineBufferRef.current = '';
        } else {
          lineBufferRef.current += char;
          if (latestOutput) {
            latestOutput(char);
          }
          console.log(`[serial0] ${char}`);
          if (!hasAnnouncedReady.current && lineBufferRef.current.toLowerCase().includes('login:')) {
            hasAnnouncedReady.current = true;
            const readyCb = latestOnReady.current;
            if (readyCb) {
              readyCb();
            }
          }
        }
      });

      instance.add_listener('download-progress', (event: unknown) => {
        const progressEvent = event as {
          file_name?: string;
          loaded?: number;
          total?: number;
          lengthComputable?: boolean;
        };
        const progressCb = latestOnDownloadProgress.current;
        if (!progressCb) {
          return;
        }
        progressCb({
          fileName: progressEvent?.file_name ?? 'resource',
          loaded: typeof progressEvent?.loaded === 'number' ? progressEvent.loaded : 0,
          total: typeof progressEvent?.total === 'number' ? progressEvent.total : undefined,
          lengthComputable: Boolean(progressEvent?.lengthComputable)
        });
      });

      instance.add_listener('download-error', (event: unknown) => {
        const downloadEvent = event as {
          file_name?: string;
          request?: { status?: number; statusText?: string };
        };
        const errorCb = latestOnDownloadError.current;
        if (!errorCb) {
          return;
        }
        errorCb({
          fileName: downloadEvent?.file_name ?? 'resource',
          status: downloadEvent?.request?.status,
          statusText: downloadEvent?.request?.statusText
        });
      });
    };

    ensureV86Script()
      .then(initializeEmulator)
      .catch((error) => {
        console.error("Failed to load the v86 runtime.", error);
      });

    return () => {
      isDisposed = true;
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      cleanupScriptListeners();
      if (emulatorInstance.current) {
        emulatorInstance.current.destroy();
        emulatorInstance.current = null;
      }
    };
  }, [initialState, emulatorConfig]);

  // Expose les fonctions au composant parent (App.tsx)
  useImperativeHandle(ref, () => ({
    serial0_send: (cmd: string) => {
      if (emulatorInstance.current) {
        emulatorInstance.current.serial0_send(cmd);
      }
    },
    keyboardType: (text: string) => {
      const emulator = emulatorInstance.current;
      if (!emulator) {
        return;
      }
      console.log(`[host] typing "${text.replace(/\n/g, "\\n")}"`);
      if (typeof emulator.keyboard_send_text === "function") {
        emulator.keyboard_send_text(text);
      }
      if (typeof emulator.serial0_send === "function") {
        emulator.serial0_send(text);
      }
    },
    runCommand: (command: string) => {
      const emulator = emulatorInstance.current;
      if (!emulator) {
        return;
      }
      console.log(`[host] runCommand "${command}"`);
      if (typeof emulator.keyboard_send_text === 'function') {
        emulator.keyboard_send_text(`${command}\n`);
      } else if (typeof emulator.serial0_send === 'function') {
        emulator.serial0_send(`${command}\r\n`);
      }
    },
    runSerialCommand: (command: string) => {
      const emulator = emulatorInstance.current;
      if (!emulator || typeof emulator.serial0_send !== 'function') {
        return;
      }
      console.log(`[host] runSerialCommand "${command}"`);
      emulator.serial0_send(`${command}\r\n`);
    },
    runKeyboardCommand: (command: string) => {
      const emulator = emulatorInstance.current;
      if (!emulator) {
        return;
      }
      console.log(`[host] runKeyboardCommand "${command}"`);
      if (typeof emulator.keyboard_send_text === 'function') {
        emulator.keyboard_send_text(command);
      }
      if (typeof emulator.serial0_send === 'function') {
        emulator.serial0_send('\r');
      } else if (typeof emulator.keyboard_send_text === 'function') {
        emulator.keyboard_send_text('\n');
      }
    },
    saveState: async () => {
      if (emulatorInstance.current) {
        // Appelle la fonction de sauvegarde de v86
        return await emulatorInstance.current.save_state();
      }
      return null;
    }
  }));

  // Le conteneur doit déjà contenir un <canvas> et une <div> pour que v86 l'initialise correctement
  const containerClassName = ['emulator-container', className].filter(Boolean).join(' ');

  const bootMedia = useMemo(
    () => [
      { label: 'Disk', available: emulatorConfig?.hda !== false },
      { label: 'ISO', available: emulatorConfig?.cdrom !== false }
    ],
    [emulatorConfig?.cdrom, emulatorConfig?.hda]
  );

  const memorySizeMb = useMemo(() => emulatorConfig?.memorySize ?? 768, [emulatorConfig?.memorySize]);

  const bootAssetsMissing = useMemo(() => {
    const hasDisk = emulatorConfig?.hda !== false;
    const hasCdrom = emulatorConfig?.cdrom !== false;
    return !initialState && !hasDisk && !hasCdrom;
  }, [emulatorConfig?.cdrom, emulatorConfig?.hda, initialState]);

  return (
    <div
      ref={screenContainerRef}
      tabIndex={0}
      className={containerClassName}
      onClick={() => screenContainerRef.current?.focus()}
    >
      <div className="emulator-status-bar" data-testid="emulator-status-bar">
        <span className="emulator-status-pill" data-testid="memory-status">
          {memorySizeMb} MB
        </span>
        {bootMedia.map((media) => (
          <span
            key={media.label}
            className={`emulator-status-pill ${media.available ? 'available' : 'missing'}`}
            data-testid={`media-${media.label.toLowerCase()}`}
          >
            {media.label}
          </span>
        ))}
      </div>
      {bootAssetsMissing ? (
        <div className="emulator-status-error" data-testid="asset-error">
          No boot assets configured. Provide a disk or ISO to launch the VM.
        </div>
      ) : null}
      <canvas />
      <div></div>
    </div>
  );
});

Emulator.displayName = 'Emulator';

export default Emulator;
