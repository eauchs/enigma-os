export type ActionStep =
  | { type: 'command'; value: string; description?: string }
  | { type: 'serial'; value: string; description?: string }
  | { type: 'keyboard'; value: string; description?: string }
  | { type: 'delay'; duration: number; description?: string };

export interface ActionPlaybookEntry {
  id: string;
  title: string;
  description: string;
  expectation?: string;
  tags?: string[];
  steps: ActionStep[];
}

export const ACTION_PLAYBOOKS: ActionPlaybookEntry[] = [
  {
    id: 'bootstrap-gui',
    title: 'Reboot desktop workspace',
    description:
      'Ensures the agent desktop is running by logging in over serial and launching the X session via keyboard.',
    expectation: 'A fully rendered desktop environment ready for interaction.',
    tags: ['boot', 'recovery'],
    steps: [
      { type: 'serial', value: '', description: 'Wake serial port' },
      { type: 'delay', duration: 500, description: 'Allow prompt to refresh' },
      { type: 'serial', value: 'root', description: 'Log into the console as root' },
      { type: 'delay', duration: 800, description: 'Wait for shell prompt' },
      {
        type: 'keyboard',
        value: 'cd /root && ./startx.sh\n',
        description: 'Launch the DSL graphical environment'
      },
      { type: 'delay', duration: 4000, description: 'Allow X11 to start fully' }
    ]
  },
  {
    id: 'network-check',
    title: 'Verify outbound connectivity',
    description: 'Opens a terminal window and performs a quick ping test to confirm network access.',
    expectation: 'Ping output showing low latency packets to example.org',
    tags: ['diagnostics', 'network'],
    steps: [
      {
        type: 'keyboard',
        value: '\u001b',
        description: 'Send Escape to dismiss any open dialog'
      },
      { type: 'delay', duration: 200 },
      {
        type: 'keyboard',
        value: 'aterm &\n',
        description: 'Launch a terminal window from the shell'
      },
      { type: 'delay', duration: 900 },
      {
        type: 'command',
        value: 'ping -c 4 example.org',
        description: 'Run ping test inside the new terminal'
      }
    ]
  },
  {
    id: 'refresh-llm-service',
    title: 'Refresh local VLM runtime',
    description:
      'Restarts the LM Studio service inside the VM so that external hosts can reconnect without rebooting.',
    expectation: 'LM Studio server restarted and ready on localhost.',
    tags: ['ai', 'maintenance'],
    steps: [
      {
        type: 'command',
        value: 'systemctl --user stop lmstudio.service',
        description: 'Stop existing LM Studio session'
      },
      { type: 'delay', duration: 1000 },
      {
        type: 'command',
        value: 'systemctl --user start lmstudio.service',
        description: 'Start the LM Studio service again'
      },
      { type: 'delay', duration: 1500 },
      {
        type: 'command',
        value: 'systemctl --user status lmstudio.service --no-pager',
        description: 'Report status back to the host'
      }
    ]
  },
  {
    id: 'capture-artifact',
    title: 'Snapshot critical directories',
    description: 'Archives key agent directories before triggering a new Âme capture.',
    expectation: 'Tar archive created inside /root/archives/.',
    tags: ['backup', 'filesystem'],
    steps: [
      {
        type: 'command',
        value: 'mkdir -p /root/archives',
        description: 'Ensure archive directory exists'
      },
      {
        type: 'command',
        value: 'tar czf /root/archives/agent-state-$(date +%s).tgz Documents/ Missions/',
        description: 'Create compressed archive of the workspace'
      }
    ]
  }
];
