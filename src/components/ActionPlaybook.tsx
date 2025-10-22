import React from 'react';
import type { ActionPlaybookEntry } from '../data/actionPlaybooks';

interface ActionPlaybookProps {
  actions: ActionPlaybookEntry[];
  isRunning: boolean;
  activeActionId: string | null;
  disabled?: boolean;
  onRun: (action: ActionPlaybookEntry) => void;
  onCopy: (action: ActionPlaybookEntry) => void;
}

const ActionPlaybook: React.FC<ActionPlaybookProps> = ({
  actions,
  isRunning,
  activeActionId,
  disabled,
  onRun,
  onCopy
}) => {
  return (
    <div className="info-card action-playbook-card">
      <div className="info-card__header">
        <h2>Action playbook</h2>
      </div>
      <p className="action-playbook__intro">
        Curated sequences the VLM can leverage for repeatable interactions inside the sovereign workspace.
      </p>
      <ul className="action-playbook__list">
        {actions.map((action) => {
          const isActive = activeActionId === action.id;
          const isActionRunning = isRunning && isActive;
          return (
            <li
              key={action.id}
              className={`action-playbook__item ${isActionRunning ? 'action-playbook__item--active' : ''}`}
            >
              <div className="action-playbook__header">
                <h3>{action.title}</h3>
                {action.tags && (
                  <ul className="action-playbook__tags">
                    {action.tags.map((tag) => (
                      <li key={tag}>{tag}</li>
                    ))}
                  </ul>
                )}
              </div>
              <p className="action-playbook__description">{action.description}</p>
              {action.expectation && (
                <p className="action-playbook__expectation">
                  <span>Outcome</span>
                  {action.expectation}
                </p>
              )}
              <div className="action-playbook__controls">
                <button
                  type="button"
                  className="control-button"
                  onClick={() => onRun(action)}
                  disabled={disabled || (isRunning && !isActive)}
                >
                  {isActionRunning ? 'Running…' : 'Run sequence'}
                </button>
                <button
                  type="button"
                  className="control-button control-button--ghost"
                  onClick={() => onCopy(action)}
                  disabled={disabled}
                >
                  Copy JSON
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default ActionPlaybook;
