import { BootStageContentSet } from '../types/boot';

export interface ManualStep {
  title: string;
  description: string;
  command?: string;
}

export interface AssetRequirement {
  label: string;
  path: string;
  description?: string;
  optional?: boolean;
  downloadUrl?: string;
}

export interface AutomationHints {
  loginPrompts: string[];
  shellPrompts: string[];
  loginCommand?: string;
  guiCommand?: string;
  readinessDelayMs?: number;
  manualLoginHint?: string;
  manualGuiHint?: string;
}

export interface EmulatorDriveConfig {
  url: string;
  async?: boolean;
}

export interface EmulatorBiosConfig {
  url: string;
  [key: string]: unknown;
}

export interface EmulatorProfile {
  memorySize?: number;
  hda?: EmulatorDriveConfig | false;
  cdrom?: EmulatorDriveConfig | false;
  bootOrder?: number;
  extraConfig?: Record<string, unknown>;
  wasmPath?: string;
  bios?: EmulatorBiosConfig;
  vgaBios?: EmulatorBiosConfig;
}

export interface AgentProfile {
  id: string;
  name: string;
  tagline: string;
  description: string;
  accent: string;
  emulator: EmulatorProfile;
  automation: AutomationHints;
  stageContent?: {
    snapshot?: BootStageContentSet;
    manual?: BootStageContentSet;
  };
  manualSteps: ManualStep[];
  assetManifest: AssetRequirement[];
  snapshotHint?: string;
}

const DEFAULT_SNAPSHOT_STAGE_CONTENT: BootStageContentSet = {
  idle: {
    title: 'Restoring agent state',
    summary: 'Rehydrating the saved Âme and preparing the VM display.',
    timelineSummary: 'Load saved memory snapshot'
  },
  waitingLogin: {
    title: 'Watching for login prompt',
    summary: 'Listening to the serial console to authenticate automatically.',
    timelineSummary: 'Detect login prompt'
  },
  waitingShell: {
    title: 'Preparing shell environment',
    summary: 'Opening a shell session and launching the graphical workspace.',
    timelineSummary: 'Log into shell'
  },
  done: {
    title: 'Launching agent GUI',
    summary: 'Starting the graphical environment so objectives can be executed.',
    timelineSummary: 'Start graphical agent'
  }
};

const DEFAULT_MANUAL_STAGE_CONTENT: BootStageContentSet = {
  idle: {
    title: 'First boot in progress',
    summary: 'No saved Âme detected. Use the VM to perform the initial setup.',
    timelineSummary: 'Boot live environment'
  },
  waitingLogin: {
    title: 'Manual login required',
    summary: 'Enter the credentials in the VM when the prompt appears.',
    timelineSummary: 'Log in manually'
  },
  waitingShell: {
    title: 'Launch GUI manually',
    summary: 'Execute the launch command in the VM to start the desktop.',
    timelineSummary: 'Start graphical environment manually'
  },
  done: {
    title: 'Capture a snapshot',
    summary: 'Once configured, save the Âme to enable automatic resumes.',
    timelineSummary: 'Capture persistent state'
  }
};

export const defaultStageContent = {
  snapshot: DEFAULT_SNAPSHOT_STAGE_CONTENT,
  manual: DEFAULT_MANUAL_STAGE_CONTENT
};

const dslProfile: AgentProfile = {
  id: 'dsl-2024',
  name: 'Damn Small Linux 2024',
  tagline: 'Ultra-light desktop ready for sovereign agents.',
  description:
    'A nimble Debian-based environment ideal for rapid boot and minimal resource usage. Perfect for running LM Studio or lightweight agent tooling inside the VM.',
  accent: '#9B5CFF',
  emulator: {
    memorySize: 768,
    hda: { url: '/images/dsl_disk.img', async: false },
    cdrom: { url: '/images/dsl-2024.rc7.iso', async: false },
    bootOrder: 0x132
  },
  automation: {
    loginPrompts: ['login:'],
    shellPrompts: ['localhost:~# '],
    loginCommand: 'root',
    guiCommand: 'cd /root && ./startx.sh',
    readinessDelayMs: 4000,
    manualLoginHint: 'Inside the VM, log in as the user "root" with an empty password.',
    manualGuiHint: 'Launch the graphical desktop by running "cd /root && ./startx.sh".'
  },
  stageContent: {
    snapshot: {
      ...DEFAULT_SNAPSHOT_STAGE_CONTENT,
      waitingShell: {
        title: 'Priming Fluxbox desktop',
        summary: 'Spawning a shell session and launching the Fluxbox workspace automatically.',
        timelineSummary: 'Open Fluxbox desktop'
      }
    },
    manual: {
      ...DEFAULT_MANUAL_STAGE_CONTENT,
      idle: {
        title: 'Booting DSL live ISO',
        summary: 'Follow the live environment prompts to reach the graphical desktop.',
        timelineSummary: 'Boot DSL live ISO'
      },
      waitingShell: {
        title: 'Launch Fluxbox manually',
        summary: 'Execute "cd /root && ./startx.sh" inside the VM to start the desktop.',
        timelineSummary: 'Start Fluxbox manually'
      }
    }
  },
  manualSteps: [
    {
      title: 'Reach the login prompt',
      description: 'Wait for Damn Small Linux to finish booting until the login prompt appears on screen.'
    },
    {
      title: 'Authenticate as root',
      description: 'Type the username \u201croot\u201d (no password required) and press Enter to enter the system.',
      command: 'root'
    },
    {
      title: 'Launch the desktop',
      description: 'Inside the shell, start the graphical environment so you can configure the agent.',
      command: 'cd /root && ./startx.sh'
    },
    {
      title: 'Tune your agent',
      description: 'Install or configure your VLM stack (LM Studio, Ollama, etc.), then capture a fresh Âme to persist everything.'
    }
  ],
  assetManifest: [
    {
      label: 'DSL disk image',
      path: '/images/dsl_disk.img',
      description: 'Writable disk containing your agent software and persistent files.',
      downloadUrl: 'https://copy.sh/v86/images/dsl/dsl_disk.img'
    },
    {
      label: 'DSL live ISO',
      path: '/images/dsl-2024.rc7.iso',
      description: 'Used for the first boot when no Âme is present.',
      downloadUrl: 'https://copy.sh/v86/images/dsl/dsl-2024.rc7.iso'
    }
  ],
  snapshotHint:
    'Capture a fresh Âme once the VM looks exactly the way you want the sovereign agent to wake up next time.'
};

export const agentProfiles: AgentProfile[] = [dslProfile];

export const defaultAgentProfileId = dslProfile.id;
