import React from 'react';
import type { PlaybookAction } from '../data/actionPlaybook';

export interface ActionPlaybookProps {
  actions: PlaybookAction[];
  runAction: (action: PlaybookAction) => Promise<void>;
  activeActionId: string | null;
  isRunning: boolean;
  lastCompletedActionId: string | null;
  errorMessage: string | null;
}

const formatDuration = (durationMs: number | undefined) => {
  if (!durationMs || durationMs <= 0) {
    return '—';
  }
  if (durationMs < 1000) {
    return `${durationMs} ms`;
  }
  const seconds = Math.round(durationMs / 100) / 10;
  return `${seconds.toFixed(seconds >= 10 ? 0 : 1)} s`;
};

export const ActionPlaybook: React.FC<ActionPlaybookProps> = ({
  actions,
  runAction,
  activeActionId,
  isRunning,
  lastCompletedActionId,
  errorMessage
}) => {
  return (
    <div className="info-card playbook-card">
      <div className="info-card__header">
        <h2>Action playbook</h2>
      </div>
      <p>
        Déclenchez des routines prédéfinies pour préparer l’agent avant une démonstration ou relancer des composants
        critiques.
      </p>
      <ul className="playbook-list">
        {actions.map((action) => {
          const isActive = activeActionId === action.id;
          const isCompleted = lastCompletedActionId === action.id;
          return (
            <li key={action.id} className={`playbook-list__item ${isActive ? 'playbook-list__item--active' : ''}`}>
              <div>
                <div className="playbook-list__title">{action.title}</div>
                <p className="playbook-list__description">{action.description}</p>
                <div className="playbook-list__meta">
                  <span>
                    Étapes&nbsp;: <strong>{action.steps.length}</strong>
                  </span>
                  <span>
                    Durée estimée&nbsp;: <strong>{formatDuration(action.estimatedDurationMs)}</strong>
                  </span>
                  {isCompleted && <span className="playbook-list__badge playbook-list__badge--success">Terminé</span>}
                </div>
              </div>
              <div className="playbook-list__actions">
                <button
                  type="button"
                  disabled={isRunning}
                  onClick={() => runAction(action).catch(() => undefined)}
                >
                  {isActive ? 'En cours…' : 'Exécuter'}
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {errorMessage && <div className="playbook-error">{errorMessage}</div>}
    </div>
  );
};

export default ActionPlaybook;
