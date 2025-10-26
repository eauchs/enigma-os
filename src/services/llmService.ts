import type {
  EmulatorRef,
  EmulatorPointerActionRequest,
  EmulatorPointerCoordinate
} from '../components/Emulator';
import {
  requestComputerUseAction,
  type ComputerUseToolCall,
  type LmStudioCompletion,
  type ComputerUseArguments
} from './lmStudioVlmClient';
import {
  resolveDefaultLmStudioConfig,
  type LmStudioEndpointConfig
} from '../config/vlm';

export type VlmServiceErrorCode =
  | 'EMULATOR_UNAVAILABLE'
  | 'SCREENSHOT_UNAVAILABLE'
  | 'SCREENSHOT_FAILED'
  | 'REQUEST_FAILED'
  | 'REQUEST_ABORTED'
  | 'EXECUTION_UNSUPPORTED'
  | 'EXECUTION_FAILED';

export class VlmServiceError extends Error {
  public readonly code: VlmServiceErrorCode;
  public readonly details?: unknown;

  constructor(code: VlmServiceErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.details = details;
    this.name = 'VlmServiceError';
  }
}

export interface OptimizeParametersResult {
  temperature: number;
  maxOutputTokens: number;
}

export const optimizeRequestParameters = (
  objective: string,
  config: Pick<LmStudioEndpointConfig, 'temperature' | 'maxOutputTokens'>
): OptimizeParametersResult => {
  const trimmed = objective.trim();
  const length = trimmed.length;
  const wordCount = trimmed ? trimmed.split(/\s+/).length : 0;

  let temperature = config.temperature;
  if (wordCount <= 6) {
    temperature = Math.max(0.05, config.temperature - 0.1);
  } else if (wordCount >= 40 || length > 220) {
    temperature = Math.min(0.75, config.temperature + 0.15);
  }

  let maxOutputTokens = config.maxOutputTokens;
  if (length > 500) {
    maxOutputTokens = Math.min(config.maxOutputTokens + 512, 3072);
  } else if (length < 160 && config.maxOutputTokens > 1024) {
    maxOutputTokens = Math.max(896, config.maxOutputTokens - 256);
  }

  return {
    temperature,
    maxOutputTokens
  };
};

export interface ProcessObjectiveOptions {
  objective: string;
  emulator: Pick<EmulatorRef, 'captureScreenshot'> | null;
  configOverrides?: Partial<LmStudioEndpointConfig>;
  fetchImplementation?: typeof fetch;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

export interface VlmProcessingMetrics {
  captureMs: number;
  requestMs: number;
}

export interface VlmProcessingResult {
  completion: LmStudioCompletion;
  toolCall?: ComputerUseToolCall;
  screenshotDataUrl: string;
  metrics: VlmProcessingMetrics;
  config: LmStudioEndpointConfig & OptimizeParametersResult;
}

export const processObjective = async (options: ProcessObjectiveOptions): Promise<VlmProcessingResult> => {
  const {
    objective,
    emulator,
    configOverrides,
    fetchImplementation,
    headers,
    signal
  } = options;

  if (!emulator) {
    throw new VlmServiceError('EMULATOR_UNAVAILABLE', 'The emulator is not ready yet.');
  }
  if (typeof emulator.captureScreenshot !== 'function') {
    throw new VlmServiceError(
      'SCREENSHOT_UNAVAILABLE',
      'This emulator does not support framebuffer capture for the VLM pipeline.'
    );
  }

  const baseConfig = resolveDefaultLmStudioConfig();
  const mergedConfig: LmStudioEndpointConfig = {
    ...baseConfig,
    ...configOverrides
  };

  const optimization = optimizeRequestParameters(objective, mergedConfig);
  const captureStart = Date.now();

  let screenshot: string | null = null;
  try {
    screenshot = await emulator.captureScreenshot({ format: 'image/png' });
  } catch (error) {
    throw new VlmServiceError('SCREENSHOT_FAILED', 'Failed to capture the VM viewport.', error);
  }

  if (!screenshot) {
    throw new VlmServiceError(
      'SCREENSHOT_FAILED',
      'The VM viewport could not be captured. Check that the emulator canvas is ready.'
    );
  }

  const captureMs = Date.now() - captureStart;
  const requestStart = Date.now();

  try {
    const completion = await requestComputerUseAction({
      objective,
      screenshotDataUrl: screenshot,
      baseUrl: mergedConfig.baseUrl,
      model: mergedConfig.model,
      temperature: optimization.temperature,
      maxOutputTokens: optimization.maxOutputTokens,
      display: { width: mergedConfig.displayWidth, height: mergedConfig.displayHeight },
      fetchImplementation,
      headers,
      signal
    });

    return {
      completion,
      toolCall: completion.toolCall,
      screenshotDataUrl: screenshot,
      metrics: {
        captureMs,
        requestMs: Date.now() - requestStart
      },
      config: {
        ...mergedConfig,
        ...optimization
      }
    };
  } catch (error) {
    if (signal?.aborted) {
      throw new VlmServiceError('REQUEST_ABORTED', 'The LM Studio request was aborted.', error);
    }
    const message = (error as Error)?.message ?? 'LM Studio request failed.';
    throw new VlmServiceError('REQUEST_FAILED', message, error);
  }
};

const POINTER_ACTIONS = new Set(['left_click', 'right_click', 'double_click', 'move', 'scroll', 'drag']);

const POINTER_ACTION_LABELS: Record<string, string> = {
  left_click: 'Left click',
  right_click: 'Right click',
  double_click: 'Double click',
  move: 'Move cursor',
  scroll: 'Scroll',
  drag: 'Drag'
};

const coerceNumber = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }
  return undefined;
};

const extractCoordinateFromValue = (value: unknown): EmulatorPointerCoordinate | undefined => {
  if (!value || typeof value !== 'object') {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  const x = coerceNumber(record.x);
  const y = coerceNumber(record.y);
  if (x === undefined && y === undefined) {
    return undefined;
  }
  const coordinate: EmulatorPointerCoordinate = {
    x: x ?? 0,
    y: y ?? 0
  };
  const referenceWidth = coerceNumber(record.referenceWidth);
  const referenceHeight = coerceNumber(record.referenceHeight);
  if (referenceWidth !== undefined) {
    coordinate.referenceWidth = referenceWidth;
  }
  if (referenceHeight !== undefined) {
    coordinate.referenceHeight = referenceHeight;
  }
  return coordinate;
};

const ensurePointerCoordinate = (
  coordinate: ComputerUseArguments['coordinate'] | undefined,
  display?: { width: number; height: number }
): EmulatorPointerCoordinate => {
  const extracted = extractCoordinateFromValue(coordinate);
  if (extracted) {
    if (!extracted.referenceWidth && display?.width) {
      extracted.referenceWidth = display.width;
    }
    if (!extracted.referenceHeight && display?.height) {
      extracted.referenceHeight = display.height;
    }
    return extracted;
  }

  if (display) {
    return {
      x: display.width / 2,
      y: display.height / 2,
      referenceWidth: display.width,
      referenceHeight: display.height
    };
  }

  throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'Pointer action requires coordinates.');
};

const formatCoordinate = (coordinate: EmulatorPointerCoordinate): string => {
  const x = Math.round(coordinate.x);
  const y = Math.round(coordinate.y);
  if (coordinate.referenceWidth && coordinate.referenceHeight) {
    return `(${x}, ${y}) on ${Math.round(coordinate.referenceWidth)}×${Math.round(coordinate.referenceHeight)}`;
  }
  return `(${x}, ${y})`;
};

const describePointerAction = (
  action: string,
  coordinate: EmulatorPointerCoordinate,
  target?: EmulatorPointerCoordinate,
  scrollDelta?: { x?: number; y?: number }
): string => {
  const label = POINTER_ACTION_LABELS[action] ?? action.replace(/_/g, ' ');
  if (action === 'drag' && target) {
    return `${label} from ${formatCoordinate(coordinate)} to ${formatCoordinate(target)}`;
  }
  if (action === 'move') {
    return `${label} to ${formatCoordinate(coordinate)}`;
  }
  if (action === 'scroll') {
    const deltaY = scrollDelta?.y ?? 0;
    const direction = deltaY === 0 ? '' : deltaY > 0 ? 'down' : 'up';
    const magnitude = Math.abs(Math.round(deltaY));
    const deltaPart = magnitude ? ` ${direction} (${magnitude})` : '';
    return `${label}${deltaPart} at ${formatCoordinate(coordinate)}`;
  }
  return `${label} at ${formatCoordinate(coordinate)}`;
};

const tryParseCoordinateFromText = (value: unknown): EmulatorPointerCoordinate | undefined => {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    return extractCoordinateFromValue(parsed);
  } catch {
    const match = trimmed.match(/(-?\d+(?:\.\d+)?)[^0-9-]+(-?\d+(?:\.\d+)?)/);
    if (match) {
      return {
        x: Number(match[1]),
        y: Number(match[2])
      };
    }
  }
  return undefined;
};

const extractScrollDelta = (args: ComputerUseArguments): { x?: number; y?: number } => {
  const record = args as Record<string, unknown>;
  const scroll =
    typeof record.scroll === 'object' && record.scroll
      ? (record.scroll as Record<string, unknown>)
      : undefined;
  const deltaX =
    coerceNumber(record.deltaX) ??
    coerceNumber(record.scrollDeltaX) ??
    coerceNumber(record.scrollX) ??
    (scroll ? coerceNumber(scroll.x) : undefined) ??
    0;
  let deltaY =
    coerceNumber(record.deltaY) ??
    coerceNumber(record.scrollDeltaY) ??
    coerceNumber(record.scrollY) ??
    (scroll ? coerceNumber(scroll.y) : undefined);

  if (deltaY === undefined && typeof args.text === 'string') {
    const lower = args.text.toLowerCase();
    if (lower.includes('up')) {
      deltaY = -120;
    } else if (lower.includes('down')) {
      deltaY = 120;
    }
  }

  if (deltaY === undefined) {
    deltaY = 120;
  }

  return {
    x: deltaX,
    y: deltaY
  };
};

const extractTextField = (args: ComputerUseArguments, keys: string[]): string | undefined => {
  const record = args as Record<string, unknown>;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

const truncateForDisplay = (value: string, max = 80): string => {
  const collapsed = value.replace(/\s+/g, ' ').trim();
  if (!collapsed) {
    return '';
  }
  return collapsed.length > max ? `${collapsed.slice(0, max - 1)}…` : collapsed;
};

const translateKeySequence = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) {
    return undefined;
  }
  const upper = trimmed.toUpperCase();
  if (upper === 'ENTER' || upper === 'RETURN') {
    return '\n';
  }
  if (upper === 'TAB') {
    return '\t';
  }
  if (upper === 'BACKSPACE') {
    return '\u0008';
  }
  if (upper === 'ESC' || upper === 'ESCAPE') {
    return '\u001b';
  }
  if (upper.startsWith('CTRL+') || upper.startsWith('CONTROL+')) {
    const key = upper.replace(/^CONTROL\+/, '').replace(/^CTRL\+/, '');
    if (key.length === 1 && key >= 'A' && key <= 'Z') {
      return String.fromCharCode(key.charCodeAt(0) - 64);
    }
    return undefined;
  }
  if (upper.includes('+')) {
    return undefined;
  }
  return trimmed;
};

export interface ExecuteToolCallOptions {
  display?: { width: number; height: number };
  focusViewport?: boolean;
}

export interface ToolExecutionResult {
  message: string;
}

export const executeToolCall = async (
  emulator: EmulatorRef,
  toolCall: ComputerUseToolCall | undefined,
  options: ExecuteToolCallOptions = {}
): Promise<ToolExecutionResult> => {
  if (!toolCall) {
    throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'No actionable tool call was returned by the VLM.');
  }

  const rawAction = toolCall.arguments?.action;
  if (typeof rawAction !== 'string' || !rawAction.trim()) {
    throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'The tool call does not define an action to execute.');
  }

  const action = rawAction.trim().toLowerCase();
  const display = options.display;

  if (POINTER_ACTIONS.has(action)) {
    if (typeof emulator.performPointerAction !== 'function') {
      throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'Pointer actions are not supported by the current emulator.');
    }
    const coordinate = ensurePointerCoordinate(toolCall.arguments.coordinate, display);
    const pointerRequest: EmulatorPointerActionRequest = {
      type: action as EmulatorPointerActionRequest['type'],
      coordinate
    };
    if (action === 'scroll') {
      pointerRequest.scrollDelta = extractScrollDelta(toolCall.arguments);
    }
    if (action === 'drag') {
      const target =
        extractCoordinateFromValue(
          (toolCall.arguments as Record<string, unknown>).target ??
            (toolCall.arguments as Record<string, unknown>).to ??
            (toolCall.arguments as Record<string, unknown>).destination ??
            (toolCall.arguments as Record<string, unknown>).end ??
            tryParseCoordinateFromText(toolCall.arguments.text)
        ) ?? null;
      if (!target) {
        throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'Drag actions require a target coordinate.');
      }
      if (!target.referenceWidth && coordinate.referenceWidth) {
        target.referenceWidth = coordinate.referenceWidth;
      }
      if (!target.referenceHeight && coordinate.referenceHeight) {
        target.referenceHeight = coordinate.referenceHeight;
      }
      pointerRequest.targetCoordinate = target;
    }
    if (options.focusViewport !== false) {
      emulator.focusViewport?.();
    }
    await Promise.resolve(emulator.performPointerAction(pointerRequest));
    const message = describePointerAction(
      action,
      coordinate,
      pointerRequest.targetCoordinate,
      pointerRequest.scrollDelta
    );
    return { message };
  }

  if (action === 'type') {
    const text = extractTextField(toolCall.arguments, ['text']);
    if (!text) {
      throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'Type actions require text to send.');
    }
    if (typeof emulator.keyboardType === 'function') {
      if (options.focusViewport !== false) {
        emulator.focusViewport?.();
      }
      emulator.keyboardType(text);
      return { message: `Typed: ${truncateForDisplay(text)}` };
    }
    if (typeof emulator.runKeyboardCommand === 'function') {
      emulator.runKeyboardCommand(text);
      return { message: `Typed via keyboard command: ${truncateForDisplay(text)}` };
    }
    throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'Keyboard input is not available.');
  }

  if (action === 'command') {
    const command = extractTextField(toolCall.arguments, ['command', 'text', 'input']);
    if (!command) {
      throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'Command actions require a command string.');
    }
    if (typeof emulator.runCommand === 'function') {
      emulator.runCommand(command);
    } else if (typeof emulator.keyboardType === 'function') {
      emulator.keyboardType(`${command}\n`);
    } else if (typeof emulator.runKeyboardCommand === 'function') {
      emulator.runKeyboardCommand(`${command}\n`);
    } else {
      throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'Shell command execution is not supported.');
    }
    return { message: `Executed command: ${truncateForDisplay(command)}` };
  }

  if (action === 'serial') {
    const serial = extractTextField(toolCall.arguments, ['text', 'command', 'input']);
    if (!serial) {
      throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'Serial actions require a payload.');
    }
    if (typeof emulator.runSerialCommand === 'function') {
      emulator.runSerialCommand(serial);
    } else if (typeof emulator.serial0_send === 'function') {
      emulator.serial0_send(`${serial}\r\n`);
    } else {
      throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'Serial console is not available.');
    }
    return { message: `Sent serial command: ${truncateForDisplay(serial)}` };
  }

  if (action === 'key') {
    const keyText = extractTextField(toolCall.arguments, ['text', 'key', 'keys']);
    if (!keyText) {
      throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'Key actions require a key sequence.');
    }
    const sequence = translateKeySequence(keyText);
    if (!sequence) {
      throw new VlmServiceError('EXECUTION_UNSUPPORTED', `Unsupported key sequence "${keyText}".`);
    }
    if (typeof emulator.keyboardType === 'function') {
      if (options.focusViewport !== false) {
        emulator.focusViewport?.();
      }
      emulator.keyboardType(sequence);
      return { message: `Pressed ${keyText}` };
    }
    throw new VlmServiceError('EXECUTION_UNSUPPORTED', 'Keyboard input is not available.');
  }

  if (action === 'noop') {
    return { message: 'No operation requested by the autopilot.' };
  }

  throw new VlmServiceError('EXECUTION_UNSUPPORTED', `Unsupported tool action "${rawAction}".`);
};

export type { ComputerUseToolCall } from './lmStudioVlmClient';
