export type BootStage = 'idle' | 'waitingLogin' | 'waitingShell' | 'done';

export type StageContent = {
  title: string;
  summary: string;
  timelineSummary: string;
};

export type BootStageContentSet = Record<BootStage, StageContent>;

export const BOOT_STAGE_ORDER: BootStage[] = ['idle', 'waitingLogin', 'waitingShell', 'done'];
