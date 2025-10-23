import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, beforeEach } from 'vitest';
import { http, HttpResponse } from 'msw';
import useHostProfile from '../useHostProfile';
import { server } from '../../setupTests';

const buildOverridePayload = () => ({
  profiles: [
    {
      id: 'dsl-2024',
      emulator: { memorySize: 1024 },
      automation: { loginPrompts: ['override'], shellPrompts: ['# '] },
      assetManifest: [
        {
          label: 'DSL disk image',
          path: '/images/dsl_disk.img'
        },
        {
          label: 'DSL live ISO',
          path: '/images/dsl-2024.rc7.iso'
        }
      ]
    },
    {
      id: 'new-profile',
      name: 'New Agent',
      tagline: 'Override',
      description: 'New profile',
      accent: '#00ffaa',
      emulator: { memorySize: 512, hda: { url: '/images/new.img' } },
      automation: { loginPrompts: ['login:'], shellPrompts: ['# '] },
      manualSteps: [
        { title: 'Step 1', description: 'Do something' }
      ],
      assetManifest: [
        { label: 'New disk', path: '/images/new.img' }
      ]
    }
  ],
  defaultProfileId: 'new-profile'
});

describe('useHostProfile', () => {
  beforeEach(() => {
    server.resetHandlers();
  });

  it('loads default TypeScript profiles when no remote config is provided', async () => {
    const { result } = renderHook(() => useHostProfile());

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.profiles.length).toBeGreaterThan(0);
    expect(result.current.activeProfile).toBe(result.current.profiles[0]);
    expect(result.current.launchConfig.memorySize).toBe(result.current.activeProfile.emulator.memorySize);
  });

  it('merges remote overrides and selects default profile from payload', async () => {
    server.use(http.get('/profiles.json', () => HttpResponse.json(buildOverridePayload())));

    const { result } = renderHook(() => useHostProfile({ configUrl: '/profiles.json' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBeNull();
    expect(result.current.profiles.some((profile) => profile.id === 'new-profile')).toBe(true);
    expect(result.current.activeProfile.id).toBe('new-profile');
    expect(result.current.launchConfig.hda).toMatchObject({ url: '/images/new.img' });
    expect(result.current.launchConfig.memorySize).toBe(512);
  });

  it('rejects unknown fields in remote payloads', async () => {
    server.use(
      http.get('/profiles.json', () =>
        HttpResponse.json({
          profiles: [
            {
              id: 'dsl-2024',
              unexpected: true,
              emulator: { memorySize: 1024 },
              automation: { loginPrompts: ['login:'], shellPrompts: ['# '] },
              assetManifest: [
                { label: 'disk', path: '/images/dsl_disk.img' }
              ]
            }
          ]
        })
      )
    );

    const { result } = renderHook(() => useHostProfile({ configUrl: '/profiles.json' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/Unsupported field/);
  });

  it('validates asset manifests and surfaces errors', async () => {
    server.use(
      http.get('/profiles.json', () =>
        HttpResponse.json({
          profiles: [
            {
              id: 'dsl-2024',
              emulator: { memorySize: 1024 },
              automation: { loginPrompts: ['login:'], shellPrompts: ['# '] },
              assetManifest: [
                { label: 'broken', path: '' }
              ]
            }
          ]
        })
      )
    );

    const { result } = renderHook(() => useHostProfile({ configUrl: '/profiles.json' }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toMatch(/Asset path is required/);
  });
});
