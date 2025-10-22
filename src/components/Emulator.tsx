import React, { forwardRef, useImperativeHandle, useRef, useEffect } from 'react';

// On définit les types pour que TypeScript comprenne ce que notre composant peut faire
export interface EmulatorRef {
  serial0_send: (cmd: string) => void;
  keyboardType: (text: string) => void;
  runCommand: (command: string) => void;
  runSerialCommand: (command: string) => void;
  runKeyboardCommand: (command: string) => void;
  saveState: () => Promise<ArrayBuffer | null>;
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

export interface EmulatorProps {
  initialState?: ArrayBuffer | null;
  bootSeed?: number;
  onReady?: () => void;
  onOutput?: (chunk: string) => void;
  onDownloadProgress?: (event: EmulatorDownloadEvent) => void;
  onDownloadError?: (event: EmulatorDownloadError) => void;
  onError?: (error: Error) => void;
  className?: string;
}

// Déclaration globale pour que TypeScript connaisse V86Starter
declare global {
  interface Window {
    V86Starter: any;
    V86?: any;
  }
}

// On type les props et la ref
const Emulator = forwardRef<EmulatorRef, EmulatorProps>(
  ({ initialState, bootSeed, onReady, onOutput, onDownloadProgress, onDownloadError, onError, className }, ref) => {
  const screenContainerRef = useRef<HTMLDivElement>(null);
  const emulatorInstance = useRef<any>(null);
  const latestOnReady = useRef(onReady);
  const latestOnOutput = useRef(onOutput);
  const latestOnDownloadProgress = useRef(onDownloadProgress);
  const latestOnDownloadError = useRef(onDownloadError);
  const latestOnError = useRef(onError);
  const hasAnnouncedReady = useRef(false);
  const lineBufferRef = useRef<string>('');
  const latestInitialState = useRef<ArrayBuffer | null>(initialState ?? null);

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
    latestInitialState.current = initialState ?? null;
  }, [bootSeed]);

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

      const config: any = {
        screen_container: screenContainerRef.current,
        keyboard_element: screenContainerRef.current,
        wasm_path: "/v86/v86.wasm",
        bios: { url: "/v86/seabios.bin" },
        vga_bios: { url: "/v86/vgabios.bin" },
        memory_size: 768 * 1024 * 1024,
        preserve_mac_from_state_image: true,
        uart_output_all: true,
        autostart: true,
        hda: { url: "/images/dsl_disk.img", async: false }
      };

      const state = latestInitialState.current;
      if (state && state.byteLength > 0) {
        console.log("Restoring agent from saved Âme...");
        config.initial_state = state;
      } else {
        console.log("First boot detected. Booting DSL ISO.");
        config.cdrom = { url: "/images/dsl-2024.rc7.iso", async: false };
        config.boot_order = 0x132;
      }

      let instance: any;
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

      instance.add_listener("emulator-ready", () => {
        console.log("Emulator is technically ready.");
        screenContainerRef.current?.focus();
        const readyCb = latestOnReady.current;
        if (readyCb && !hasAnnouncedReady.current) {
          hasAnnouncedReady.current = true;
          readyCb();
        }
      });

      instance.add_listener("serial0-output-byte", (charCode: number) => {
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

      instance.add_listener('download-progress', (event: any) => {
        const progressCb = latestOnDownloadProgress.current;
        if (!progressCb) {
          return;
        }
        progressCb({
          fileName: event?.file_name ?? 'resource',
          loaded: typeof event?.loaded === 'number' ? event.loaded : 0,
          total: typeof event?.total === 'number' ? event.total : undefined,
          lengthComputable: Boolean(event?.lengthComputable)
        });
      });

      instance.add_listener('download-error', (event: any) => {
        const errorCb = latestOnDownloadError.current;
        if (!errorCb) {
          return;
        }
        errorCb({
          fileName: event?.file_name ?? 'resource',
          status: event?.request?.status,
          statusText: event?.request?.statusText
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
  }, [initialState]);

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

  return (
    <div
      ref={screenContainerRef}
      tabIndex={0}
      className={containerClassName}
      onClick={() => screenContainerRef.current?.focus()}
    >
      <canvas />
      <div></div>
    </div>
  );
});

export default Emulator;
