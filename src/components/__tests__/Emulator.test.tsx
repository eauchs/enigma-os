import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import Emulator, { EmulatorRef } from '../Emulator';

interface StubInstance {
  listeners: Record<string, ((payload?: unknown) => void)[]>;
  serial0_send: (value: string) => void;
  keyboard_send_text: (value: string) => void;
  save_state: () => Promise<ArrayBuffer>;
  destroy: () => void;
  emit: (event: string, payload?: unknown) => void;
}

declare global {
  interface Window {
    V86Starter: vi.Mock;
  }
}

const createStub = (): StubInstance => {
  const listeners: Record<string, ((payload?: unknown) => void)[]> = {};
  return {
    listeners,
    serial0_send: vi.fn(),
    keyboard_send_text: vi.fn(),
    save_state: vi.fn().mockResolvedValue(new ArrayBuffer(2)),
    destroy: vi.fn(),
    emit: (event, payload) => {
      listeners[event]?.forEach((listener) => listener(payload));
    }
  };
};

describe('Emulator component', () => {
  let instance: StubInstance;
  let ref: React.RefObject<EmulatorRef>;

  beforeEach(() => {
    instance = createStub();
    window.V86Starter = vi.fn().mockImplementation(() => {
      return {
        ...instance,
        add_listener: (event: string, callback: (payload?: unknown) => void) => {
          if (!instance.listeners[event]) {
            instance.listeners[event] = [];
          }
          instance.listeners[event].push(callback);
        }
      };
    });
    ref = { current: null };
  });

  it('renders status pills reflecting the launch configuration', () => {
    render(<Emulator ref={ref} emulatorConfig={{ memorySize: 512, cdrom: { url: '/iso.iso' } }} />);

    expect(screen.getByTestId('memory-status')).toHaveTextContent('512');
    expect(screen.getByTestId('media-disk')).toHaveClass('emulator-status-pill');
    expect(screen.getByTestId('media-disk')).toHaveClass('available');
    expect(screen.getByTestId('media-iso')).toHaveClass('emulator-status-pill');
    expect(screen.getByTestId('media-iso')).toHaveClass('available');
  });

  it('updates status when the emulator configuration changes', () => {
    const { rerender } = render(<Emulator ref={ref} emulatorConfig={{ memorySize: 512 }} />);
    expect(screen.getByTestId('memory-status')).toHaveTextContent('512');

    rerender(<Emulator ref={ref} emulatorConfig={{ memorySize: 1024 }} />);
    expect(screen.getByTestId('memory-status')).toHaveTextContent('1024');
  });

  it('shows an error when no boot media is defined', () => {
    render(<Emulator ref={ref} initialState={null} emulatorConfig={{ hda: false, cdrom: false }} />);
    expect(screen.getByTestId('asset-error')).toBeInTheDocument();
  });

  it('invokes lifecycle callbacks emitted by the emulator stub', async () => {
    const onReady = vi.fn();
    const onDownloadProgress = vi.fn();
    const onDownloadError = vi.fn();

    render(
      <Emulator
        ref={ref}
        onReady={onReady}
        onDownloadProgress={onDownloadProgress}
        onDownloadError={onDownloadError}
      />
    );

    await waitFor(() => expect(window.V86Starter).toHaveBeenCalled());

    instance.emit('emulator-ready');
    instance.emit('download-progress', { file_name: 'disk', loaded: 10, total: 20 });
    instance.emit('download-error', { file_name: 'iso', request: { status: 404, statusText: 'Not Found' } });

    await waitFor(() => expect(onReady).toHaveBeenCalled());
    await waitFor(() =>
      expect(onDownloadProgress).toHaveBeenCalledWith({
        fileName: 'disk',
        loaded: 10,
        total: 20,
        lengthComputable: false
      })
    );
    expect(onDownloadError).toHaveBeenCalledWith({ fileName: 'iso', status: 404, statusText: 'Not Found' });
  });
});
