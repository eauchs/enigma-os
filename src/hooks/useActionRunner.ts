import { MutableRefObject, useCallback, useRef, useState } from 'react';
import type { EmulatorRef } from '../components/Emulator';
import type { ActionPlaybookEntry, ActionStep } from '../data/actionPlaybooks';

const wait = (duration: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, duration);
  });

const executeStep = async (emulator: EmulatorRef, step: ActionStep) => {
  switch (step.type) {
    case 'command':
      emulator.runCommand(step.value);
      return;
    case 'serial':
      emulator.runSerialCommand(step.value);
      return;
    case 'keyboard':
      emulator.keyboardType(step.value);
      return;
    case 'delay':
      await wait(step.duration);
      return;
    default:
      return;
  }
};

export const useActionRunner = (emulatorRef: MutableRefObject<EmulatorRef | null>) => {
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const isRunningRef = useRef(false);

  const runAction = useCallback(
    async (action: ActionPlaybookEntry): Promise<{ success: boolean; error?: string }> => {
      if (isRunningRef.current) {
        setLastError('Another action is already running.');
        return { success: false, error: 'Another action is already running.' };
      }
      const emulator = emulatorRef.current;
      if (!emulator) {
        setLastError('Emulator is not ready yet.');
        return { success: false, error: 'Emulator is not ready yet.' };
      }

      isRunningRef.current = true;
      setIsRunning(true);
      setActiveActionId(action.id);
      setLastError(null);

      try {
        for (const step of action.steps) {
          await executeStep(emulator, step);
          if (step.type !== 'delay') {
            await wait(200);
          }
        }
        return { success: true };
      } catch (error) {
        const message = (error as Error)?.message ?? 'Unexpected error while running action.';
        setLastError(message);
        return { success: false, error: message };
      } finally {
        isRunningRef.current = false;
        setIsRunning(false);
        setActiveActionId(null);
      }
    },
    [emulatorRef]
  );

  const cancelActive = useCallback(() => {
    if (!isRunningRef.current) {
      return;
    }
    // There is no abort API on v86 commands, but we clear the flag so new actions can start.
    isRunningRef.current = false;
    setIsRunning(false);
    setActiveActionId(null);
  }, []);

  return {
    runAction,
    cancelActive,
    activeActionId,
    lastError,
    isRunning
  };
};

