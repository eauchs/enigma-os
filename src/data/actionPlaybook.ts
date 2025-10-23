export type PlaybookStepType = 'serial' | 'keyboard' | 'command' | 'pause' | 'status';

export interface PlaybookStep {
  id: string;
  type: PlaybookStepType;
  label: string;
  command?: string;
  durationMs?: number;
  status?: string;
}

export interface PlaybookAction {
  id: string;
  title: string;
  description: string;
  steps: PlaybookStep[];
  estimatedDurationMs?: number;
}

export const ACTION_PLAYBOOKS: PlaybookAction[] = [
  {
    id: 'refresh-gui',
    title: 'Redémarrer Fluxbox',
    description:
      'Relance le gestionnaire de fenêtres Fluxbox et nettoie les processus graphiques bloqués après une session lourde.',
    estimatedDurationMs: 6000,
    steps: [
      {
        id: 'announce',
        type: 'status',
        label: 'Annonce',
        status: 'Redémarrage de Fluxbox…'
      },
      {
        id: 'close-fluxbox',
        type: 'serial',
        label: 'Tuer Fluxbox',
        command: 'pkill fluxbox'
      },
      {
        id: 'wait-terminate',
        type: 'pause',
        label: 'Attente extinction',
        durationMs: 1000
      },
      {
        id: 'restart',
        type: 'keyboard',
        label: 'Relancer',
        command: 'cd /root && ./startx.sh\n'
      },
      {
        id: 'pause-final',
        type: 'pause',
        label: 'Stabilisation',
        durationMs: 4000
      },
      {
        id: 'final-status',
        type: 'status',
        label: 'Terminé',
        status: 'Fluxbox relancé.'
      }
    ]
  },
  {
    id: 'start-lm-studio',
    title: 'Lancer LM Studio',
    description: 'Démarre LM Studio si l’application est installée dans le profil Damn Small Linux.',
    estimatedDurationMs: 8000,
    steps: [
      {
        id: 'status-start',
        type: 'status',
        label: 'Annonce',
        status: 'Ouverture de LM Studio…'
      },
      {
        id: 'open-terminal',
        type: 'keyboard',
        label: 'Ouvrir terminal',
        command: 'xfce4-terminal\n'
      },
      {
        id: 'pause-terminal',
        type: 'pause',
        label: 'Attente terminal',
        durationMs: 1500
      },
      {
        id: 'launch',
        type: 'keyboard',
        label: 'Lancer LM Studio',
        command: 'cd /root/lmstudio && ./lmstudio.AppImage\n'
      },
      {
        id: 'pause-launch',
        type: 'pause',
        label: 'Initialisation',
        durationMs: 5000
      },
      {
        id: 'status-done',
        type: 'status',
        label: 'Terminé',
        status: 'LM Studio lancé.'
      }
    ]
  },
  {
    id: 'capture-snapshot',
    title: 'Capturer une Âme rapide',
    description: "Sauvegarde l'état actuel via l'API V86 avant une démonstration.",
    estimatedDurationMs: 3000,
    steps: [
      {
        id: 'status-begin',
        type: 'status',
        label: 'Annonce',
        status: 'Capture instantanée en cours…'
      },
      {
        id: 'pause-prep',
        type: 'pause',
        label: 'Préparation',
        durationMs: 500
      },
      {
        id: 'save',
        type: 'command',
        label: 'Capture via saveState',
        command: '__CAPTURE__'
      },
      {
        id: 'pause-final',
        type: 'pause',
        label: 'Finalisation',
        durationMs: 500
      },
      {
        id: 'status-finished',
        type: 'status',
        label: 'Terminé',
        status: 'Snapshot capturé.'
      }
    ]
  }
];
