import { describe, expect, it, vi } from 'vitest';
import { executeToolCall, optimizeRequestParameters, VlmServiceError } from '../llmService';
import type { ComputerUseToolCall, ComputerUseArguments } from '../lmStudioVlmClient';
import type { EmulatorRef } from '../../components/Emulator';

const createBaseEmulator = () =>
  ({
    serial0_send: vi.fn(),
    keyboardType: vi.fn(),
    runCommand: vi.fn(),
    runSerialCommand: vi.fn(),
    runKeyboardCommand: vi.fn(),
    saveState: vi.fn(async () => null),
    captureScreenshot: vi.fn(async () => null)
  }) as unknown as EmulatorRef;

const createToolCall = (
  action: string,
  args: Partial<ComputerUseArguments> = {}
): ComputerUseToolCall => ({
  name: 'computer_use',
  arguments: {
    action,
    ...args
  } as ComputerUseArguments
});

describe('optimizeRequestParameters', () => {
  it('reduces temperature for short objectives', () => {
    const baseConfig = { temperature: 0.3, maxOutputTokens: 1536 };
    const { temperature, maxOutputTokens } = optimizeRequestParameters('Ping server', baseConfig);
    expect(temperature).toBeLessThan(baseConfig.temperature);
    expect(maxOutputTokens).toBeLessThanOrEqual(baseConfig.maxOutputTokens);
  });

  it('increases token allowance for longer objectives', () => {
    const baseConfig = { temperature: 0.3, maxOutputTokens: 1536 };
    const longObjective = 'Install dependencies and configure the environment '.repeat(12);
    const { maxOutputTokens, temperature } = optimizeRequestParameters(longObjective, baseConfig);
    expect(maxOutputTokens).toBeGreaterThan(baseConfig.maxOutputTokens);
    expect(temperature).toBeGreaterThanOrEqual(baseConfig.temperature);
  });
});

describe('executeToolCall', () => {
  it('dispatches pointer actions when supported by the emulator', async () => {
    const performPointerAction = vi.fn(async () => undefined);
    const focusViewport = vi.fn();
    const emulator = createBaseEmulator();
    emulator.performPointerAction = performPointerAction;
    emulator.focusViewport = focusViewport;

    const toolCall = createToolCall('left_click', {
      coordinate: { x: 100, y: 200, referenceWidth: 1280, referenceHeight: 720 }
    });

    const result = await executeToolCall(emulator, toolCall);

    expect(performPointerAction).toHaveBeenCalledTimes(1);
    expect(performPointerAction).toHaveBeenCalledWith({
      type: 'left_click',
      coordinate: { x: 100, y: 200, referenceWidth: 1280, referenceHeight: 720 }
    });
    expect(focusViewport).toHaveBeenCalled();
    expect(result.message).toContain('Left click');
    expect(result.message).toContain('(100, 200)');
  });

  it('reports an error when pointer actions are unsupported', async () => {
    const emulator = createBaseEmulator();
    const toolCall = createToolCall('left_click', {
      coordinate: { x: 50, y: 50, referenceWidth: 640, referenceHeight: 480 }
    });

    await expect(executeToolCall(emulator, toolCall)).rejects.toBeInstanceOf(VlmServiceError);
  });

  it('types text via keyboardType and summarizes the action', async () => {
    const emulator = createBaseEmulator();
    const toolCall = createToolCall('type', { text: 'hello world' });

    const result = await executeToolCall(emulator, toolCall);

    expect(emulator.keyboardType).toHaveBeenCalledWith('hello world');
    expect(result.message).toContain('Typed');
    expect(result.message).toContain('hello world');
  });

  it('executes commands through runCommand when available', async () => {
    const emulator = createBaseEmulator();
    const toolCall = createToolCall('command', { text: 'sudo apt update' });

    const result = await executeToolCall(emulator, toolCall);

    expect(emulator.runCommand).toHaveBeenCalledWith('sudo apt update');
    expect(result.message).toContain('Executed command');
  });

  it('throws when drag actions are missing a target coordinate', async () => {
    const performPointerAction = vi.fn(async () => undefined);
    const emulator = createBaseEmulator();
    emulator.performPointerAction = performPointerAction;

    const dragCall = createToolCall('drag', {
      coordinate: { x: 10, y: 10, referenceWidth: 800, referenceHeight: 600 }
    });

    await expect(executeToolCall(emulator, dragCall)).rejects.toBeInstanceOf(VlmServiceError);
    expect(performPointerAction).not.toHaveBeenCalled();
  });

  it('converts key actions like CTRL+C into control characters', async () => {
    const emulator = createBaseEmulator();
    const keyCall = createToolCall('key', { text: 'CTRL+C' });

    const result = await executeToolCall(emulator, keyCall);

    expect(emulator.keyboardType).toHaveBeenCalledWith('\u0003');
    expect(result.message).toContain('Pressed CTRL+C');
  });
});
