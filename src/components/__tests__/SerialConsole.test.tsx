import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import SerialConsole, { SerialCopyResult } from '../SerialConsole';
const originalExecCommand = document.execCommand;

describe('SerialConsole', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: originalExecCommand
    });
  });

  it('renders placeholder and disables copy when empty', () => {
    render(<SerialConsole log="" placeholder="Waiting for serial output…" />);

    expect(screen.getByText('Waiting for serial output…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy serial log/i })).toBeDisabled();
  });

  it('copies using the async clipboard API when available', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const onCopyResult = vi.fn<(result: SerialCopyResult) => void>();

    render(<SerialConsole log={'Hello\nworld'} onCopyResult={onCopyResult} clipboard={{ writeText }} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /copy serial log/i }));

    expect(writeText).toHaveBeenCalledWith('Hello\nworld');
    expect(onCopyResult).toHaveBeenLastCalledWith({ success: true });
    await screen.findByText('Serial log copied to clipboard.');
  });

  it('falls back to document.execCommand when clipboard API is unavailable', async () => {
    const execCommand = vi.fn().mockReturnValue(true);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand as unknown as typeof document.execCommand
    });

    const onCopyResult = vi.fn<(result: SerialCopyResult) => void>();
    render(<SerialConsole log="serial output" onCopyResult={onCopyResult} clipboard={null} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /copy serial log/i }));

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(onCopyResult).toHaveBeenLastCalledWith({ success: true });
    await screen.findByText('Serial log copied to clipboard.');
  });

  it('reports unsupported when fallback copy fails', async () => {
    const execCommand = vi.fn().mockReturnValue(false);
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand as unknown as typeof document.execCommand
    });

    const onCopyResult = vi.fn<(result: SerialCopyResult) => void>();
    render(<SerialConsole log="serial" onCopyResult={onCopyResult} clipboard={null} />);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /copy serial log/i }));

    expect(execCommand).toHaveBeenCalledWith('copy');
    expect(onCopyResult).toHaveBeenLastCalledWith({ success: false, reason: 'unsupported' });
    await screen.findByText('Clipboard access is not available.');
  });
});
