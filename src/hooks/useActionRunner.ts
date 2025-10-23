import { useCallback, useMemo, useState } from 'react';
import type { EmulatorRef } from '../components/Emulator';
import type { PlaybookAction, PlaybookStep } from '../data/actionPlaybook';

export interface RunActionOptions {
  onStatus?: (message: string) => void;
  onCapture?: () => Promise<void>;
}

export interface UseActionRunnerResult {
  runAction: (action: PlaybookAction) => Promise<void>;
  isRunning: boolean;
  activeActionId: string | null;
  lastError: Error | null;
  lastCompletedActionId: string | null;
}

const STEP_PAUSE_DEFAULT = 750;

export const useActionRunner = (
  emulatorRef: React.RefObject<EmulatorRef | null>,
  options: RunActionOptions = {}
): UseActionRunnerResult => {
  const [isRunning, setIsRunning] = useState(false);
  const [activeActionId, setActiveActionId] = useState<string | null>(null);
  const [lastCompletedActionId, setLastCompletedActionId] = useState<string | null>(null);
  const [lastError, setLastError] = useState<Error | null>(null);

  const runStep = useCallback(
    async (step: PlaybookStep) => {
      const emulator = emulatorRef.current;
      if (!emulator) {
        throw new Error('Emulator not ready.');
      }

      switch (step.type) {
        case 'serial':
          if (!step.command) {
            throw new Error(`Step "${step.id}" lacks command.`);
          }
          emulator.runSerialCommand(step.command);
          break;
        case 'keyboard':
          if (!step.command) {
            throw new Error(`Step "${step.id}" lacks command.`);
          }
          emulator.runKeyboardCommand(step.command);
          break;
        case 'command':
          if (step.command === '__CAPTURE__') {
            await options.onCapture?.();
            break;
          }
          if (!step.command) {
            throw new Error(`Step "${step.id}" requires command.`);
          }
          emulator.runCommand(step.command);
          break;
        case 'pause': {
          const delay = step.durationMs ?? STEP_PAUSE_DEFAULT;
          await new Promise<void>((resolve) => setTimeout(resolve, delay));
          break;
        }
        case 'status':
          if (step.status) {
            options.onStatus?.(step.status);
          }
          break;
        default:
          throw new Error(`Unsupported step type: ${(step as PlaybookStep).type}`);
      }
    },
    [emulatorRef, options]
  );

  const runAction = useCallback(
    async (action: PlaybookAction) => {
      if (isRunning) {
        throw new Error('Another action is already running.');
      }
      setIsRunning(true);
      setActiveActionId(action.id);
      setLastError(null);

      try {
        for (const step of action.steps) {
          await runStep(step);
          if (step.type === 'keyboard') {
            await new Promise<void>((resolve) => setTimeout(resolve, step.durationMs ?? 250));
          }
        }
        setLastCompletedActionId(action.id);
      } catch (error) {
        setLastError(error instanceof Error ? error : new Error(String(error)));
        throw error;
      } finally {
        setActiveActionId(null);
        setIsRunning(false);
      }
    },
    [isRunning, runStep]
  );

  return useMemo(
    () => ({
      runAction,
      isRunning,
      activeActionId,
      lastError,
      lastCompletedActionId
    }),
    [runAction, isRunning, activeActionId, lastError, lastCompletedActionId]
  );
};

export default useActionRunner;
