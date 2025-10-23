import { describe, expect, it, vi } from 'vitest';
import {
  requestComputerUseAction,
  summarizeToolCall,
  type ComputerUseToolCall
} from '../lmStudioVlmClient';

const createResponse = (body: unknown) =>
  Promise.resolve({
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => JSON.stringify(body)
  } as Response);

describe('lmStudioVlmClient', () => {
  it('sends the screenshot and objective to the LM Studio endpoint', async () => {
    const fetchMock = vi.fn(() =>
      createResponse({
        choices: [
          {
            finish_reason: 'stop',
            message: {
              content: [
                {
                  type: 'text',
                  text: '<tool_call>\n{"action":"left_click","coordinate":{"x":540,"y":360,"referenceWidth":1280,"referenceHeight":720}}\n</tool_call>'
                }
              ]
            }
          }
        ]
      })
    );

    const result = await requestComputerUseAction({
      objective: 'Open the third issue',
      screenshotDataUrl: 'data:image/png;base64,abc123',
      baseUrl: 'http://localhost:1234/',
      model: 'test-model',
      display: { width: 1280, height: 720 },
      fetchImplementation: fetchMock
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    const payload = JSON.parse((init as RequestInit).body as string);
    expect(payload.model).toBe('test-model');
    expect(payload.messages[1].content[0].image_url.url).toBe('data:image/png;base64,abc123');
    expect(result.toolCall?.arguments.action).toBe('left_click');
    expect(result.toolCall?.arguments.coordinate?.x).toBe(540);
  });

  it('parses structured tool calls returned by LM Studio', async () => {
    const fetchMock = vi.fn(() =>
      createResponse({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              tool_calls: [
                {
                  function: {
                    name: 'computer_use',
                    arguments: JSON.stringify({
                      action: 'type',
                      text: 'sudo apt update',
                      reasoning: 'Ensure repositories are refreshed.'
                    })
                  }
                }
              ]
            }
          }
        ]
      })
    );

    const result = await requestComputerUseAction({
      objective: 'Refresh the package cache',
      screenshotDataUrl: 'data:image/png;base64,zzz',
      baseUrl: 'http://lmstudio:1234',
      model: 'demo',
      fetchImplementation: fetchMock
    });

    expect(result.toolCall?.arguments.action).toBe('type');
    expect(result.toolCall?.arguments.text).toBe('sudo apt update');
    expect(result.toolCall?.arguments.reasoning).toBe('Ensure repositories are refreshed.');
  });

  it('summarizes tool calls into a human readable string', () => {
    const toolCall: ComputerUseToolCall = {
      name: 'computer_use',
      arguments: {
        action: 'type',
        text: 'hello world',
        reasoning: 'Demonstration',
        coordinate: { x: 400, y: 200, referenceWidth: 1280, referenceHeight: 720 }
      }
    };

    const summary = summarizeToolCall(toolCall);
    expect(summary).toContain('type');
    expect(summary).toContain('hello world');
    expect(summary).toContain('Demonstration');
  });
});
