import { useCallback, useEffect, useMemo, useState } from 'react';
import type { EmulatorBootConfig } from '../components/Emulator';
import {
  AgentProfile,
  agentProfiles as defaultProfiles,
  defaultAgentProfileId
} from '../config/agentProfiles';

export interface UseHostProfileOptions {
  configUrl?: string | null;
}

export interface UseHostProfileResult {
  profiles: AgentProfile[];
  activeProfile: AgentProfile;
  loading: boolean;
  error: string | null;
  launchConfig: EmulatorBootConfig;
  selectProfile: (id: string) => void;
}

interface RawAgentProfile extends Partial<AgentProfile> {
  id: string;
}

interface RemoteProfileConfig {
  profiles?: RawAgentProfile[];
  defaultProfileId?: string;
}

const allowedProfileKeys = new Set<keyof RawAgentProfile>([
  'id',
  'name',
  'tagline',
  'description',
  'accent',
  'emulator',
  'automation',
  'manualSteps',
  'assetManifest',
  'stageContent',
  'snapshotHint'
]);

const toErrorMessage = (value: unknown) => {
  if (value instanceof Error) {
    return value.message;
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return 'Unknown error';
  }
};

const validateAsset = (asset: AgentProfile['assetManifest'][number]): AgentProfile['assetManifest'][number] => {
  if (!asset || typeof asset.path !== 'string' || !asset.path.trim()) {
    throw new Error('Asset path is required.');
  }
  if (typeof asset.label !== 'string' || !asset.label.trim()) {
    throw new Error('Asset label is required.');
  }
  return {
    ...asset,
    label: asset.label.trim(),
    path: asset.path.trim()
  };
};

const validateProfile = (profile: AgentProfile): AgentProfile => {
  if (!profile.id || !profile.name) {
    throw new Error('Profile id and name are required.');
  }
  if (!profile.emulator) {
    throw new Error(`Profile ${profile.id} is missing emulator configuration.`);
  }
  const memorySize = profile.emulator.memorySize ?? 0;
  if (!Number.isFinite(memorySize) || memorySize <= 0) {
    throw new Error(`Profile ${profile.id} requires a positive memorySize.`);
  }
  const validatedAssets = profile.assetManifest.map((asset) => validateAsset(asset));
  return {
    ...profile,
    assetManifest: validatedAssets
  };
};

const mergeProfile = (base: AgentProfile | undefined, override: RawAgentProfile): AgentProfile => {
  Object.keys(override).forEach((key) => {
    if (!allowedProfileKeys.has(key as keyof RawAgentProfile)) {
      throw new Error(`Unsupported field "${key}" in profile override ${override.id}.`);
    }
  });

  if (!base) {
    if (!override) {
      throw new Error('Cannot merge undefined profile.');
    }
    const manualSteps = override.manualSteps ?? [];
    const assetManifest = override.assetManifest ?? [];
    const emulator = override.emulator ?? { memorySize: 512 };
    const automation = override.automation ?? {
      loginPrompts: ['login:'],
      shellPrompts: ['# ']
    };
    const profile: AgentProfile = {
      ...(override as AgentProfile),
      manualSteps,
      assetManifest,
      emulator,
      automation,
      accent: override.accent ?? '#888888',
      tagline: override.tagline ?? override.name ?? 'Agent profile',
      description: override.description ?? override.name ?? 'Agent profile',
      stageContent: override.stageContent
    };
    return validateProfile(profile);
  }

  const merged: AgentProfile = {
    ...base,
    ...override,
    automation: {
      ...base.automation,
      ...(override.automation ?? {})
    },
    emulator: {
      ...base.emulator,
      ...(override.emulator ?? {})
    },
    manualSteps: override.manualSteps ?? base.manualSteps,
    assetManifest: (override.assetManifest ?? base.assetManifest).map((asset) => validateAsset(asset)),
    stageContent: override.stageContent
      ? {
          snapshot: {
            ...base.stageContent?.snapshot,
            ...override.stageContent.snapshot
          },
          manual: {
            ...base.stageContent?.manual,
            ...override.stageContent.manual
          }
        }
      : base.stageContent
  };

  return validateProfile(merged);
};

const deriveLaunchConfig = (profile: AgentProfile): EmulatorBootConfig => {
  const emulator = profile.emulator;
  return {
    memorySize: emulator.memorySize,
    hda: emulator.hda ?? false,
    cdrom: emulator.cdrom ?? false,
    bootOrder: emulator.bootOrder,
    extraConfig: emulator.extraConfig,
    wasmPath: emulator.wasmPath,
    bios: emulator.bios,
    vgaBios: emulator.vgaBios
  };
};

export const useHostProfile = (options: UseHostProfileOptions = {}): UseHostProfileResult => {
  const { configUrl = null } = options;
  const [profiles, setProfiles] = useState<AgentProfile[]>(() => defaultProfiles.map((profile) => ({ ...profile })));
  const [activeId, setActiveId] = useState<string>(defaultAgentProfileId);
  const [loading, setLoading] = useState<boolean>(Boolean(configUrl));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!configUrl) {
      setLoading(false);
      return () => {
        cancelled = true;
      };
    }

    const loadConfig = async () => {
      setLoading(true);
      try {
        const response = await fetch(configUrl, { cache: 'no-store' });
        if (!response.ok) {
          throw new Error(`Failed to load profile config (${response.status})`);
        }
        const payload = (await response.json()) as RemoteProfileConfig;
        if (cancelled) {
          return;
        }
        const overrides = payload.profiles ?? [];
        const mergedMap = new Map<string, AgentProfile>();
        defaultProfiles.forEach((profile) => {
          mergedMap.set(profile.id, { ...profile });
        });

        overrides.forEach((rawProfile) => {
          if (!rawProfile || typeof rawProfile.id !== 'string') {
            throw new Error('Override profile is missing id.');
          }
          const base = mergedMap.get(rawProfile.id);
          const merged = mergeProfile(base, rawProfile);
          mergedMap.set(merged.id, merged);
        });

        const orderedProfiles = Array.from(mergedMap.values()).sort((a, b) => a.name.localeCompare(b.name));

        const sanitizedProfiles = orderedProfiles.map((profile) => validateProfile({ ...profile }));

        setProfiles(sanitizedProfiles);
        if (payload.defaultProfileId && mergedMap.has(payload.defaultProfileId)) {
          setActiveId(payload.defaultProfileId);
        }
        setError(null);
      } catch (loadError) {
        if (!cancelled) {
          setError(toErrorMessage(loadError));
          setProfiles(defaultProfiles.map((profile) => ({ ...profile })));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void loadConfig();

    return () => {
      cancelled = true;
    };
  }, [configUrl]);

  const activeProfile = useMemo(() => {
    return profiles.find((profile) => profile.id === activeId) ?? profiles[0];
  }, [profiles, activeId]);

  const launchConfig = useMemo(() => deriveLaunchConfig(activeProfile), [activeProfile]);

  const selectProfile = useCallback((id: string) => {
    setActiveId(id);
  }, []);

  return {
    profiles,
    activeProfile,
    loading,
    error,
    launchConfig,
    selectProfile
  };
};

export default useHostProfile;
