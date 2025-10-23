import React from 'react';
import { BOOT_STAGE_ORDER, BootStage, StageContent } from '../types/boot';

type RibbonState = 'complete' | 'active' | 'pending';

interface StatusRibbonProps {
  bootStage: BootStage;
  stageContent: Record<BootStage, StageContent>;
  statusPillState: string;
}

const determineState = (current: BootStage, stage: BootStage): RibbonState => {
  const currentIndex = BOOT_STAGE_ORDER.indexOf(current);
  const stageIndex = BOOT_STAGE_ORDER.indexOf(stage);
  if (stageIndex < currentIndex) {
    return 'complete';
  }
  if (stageIndex === currentIndex) {
    return 'active';
  }
  return 'pending';
};

export const StatusRibbon: React.FC<StatusRibbonProps> = ({ bootStage, stageContent, statusPillState }) => {
  return (
    <div className={`status-ribbon ${statusPillState === 'error' ? 'status-ribbon--error' : ''}`}>
      {BOOT_STAGE_ORDER.map((stage) => {
        const state = determineState(bootStage, stage);
        const content = stageContent[stage];
        return (
          <div key={stage} className={`status-ribbon__node status-ribbon__node--${state}`}>
            <span className="status-ribbon__icon" aria-hidden="true" />
            <span className="status-ribbon__title">{content.title}</span>
            <span className="status-ribbon__summary">{content.timelineSummary}</span>
          </div>
        );
      })}
    </div>
  );
};

export default StatusRibbon;
