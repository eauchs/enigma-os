import { resolveDefaultLmStudioConfig } from '../config/vlm';

export interface ComputerUseCoordinate {
  x: number;
  y: number;
  referenceWidth?: number;
  referenceHeight?: number;
}

export interface ComputerUseArguments {
  action: string;
  coordinate?: ComputerUseCoordinate;
  text?: string;
  reasoning?: string;
  [key: string]: unknown;
}

export interface ComputerUseToolCall {
  name: string;
  arguments: ComputerUseArguments;
}

export interface LmStudioCompletion {
  rawText: string;
  finishReason?: string | null;
  toolCall?: ComputerUseToolCall;
  rawResponse: unknown;
}

export interface RequestComputerUseActionOptions {
  objective: string;
  screenshotDataUrl: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  display?: { width: number; height: number };
  fetchImplementation?: typeof fetch;
  headers?: Record<string, string>;
}

interface ChatCompletionResponse {
  choices?: Array<{
    finish_reason?: string | null;
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
      tool_calls?: Array<{
        function?: { name?: string; arguments?: string };
      }>;
    };
  }>;
}

const COMPUTER_USE_TOOL = {
  type: 'function',
  function: {
    name: 'computer_use',
    description:
      'Plan the next interaction with the remote desktop. Use it to indicate pointer coordinates, key presses or text you want to type.',
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          description:
            'High-level instruction such as left_click, right_click, double_click, drag, key, type or command.'
        },
        coordinate: {
          type: 'object',
          description:
            'Absolute coordinate relative to the provided display width and height. The model receives a resized screenshot; keep coordinates aligned with the original resolution.',
          properties: {
            x: { type: 'number' },
            y: { type: 'number' },
            referenceWidth: { type: 'number' },
            referenceHeight: { type: 'number' }
          }
        },
        text: {
          type: 'string',
          description: 'Text to type or command to run when the action involves typing.'
        },
        reasoning: {
          type: 'string',
          description: 'Short rationale describing why this action helps accomplish the objective.'
        }
      },
      required: ['action'],
      additionalProperties: true
    }
  }
};

const ensureDataUrl = (value: string) => {
  if (value.startsWith('data:')) {
    return value;
  }
  return `data:image/png;base64,${value}`;
};

const gatherMessageText = (
  content: string | Array<{ type?: string; text?: string }> | undefined
): string => {
  if (!content) {
    return '';
  }
  if (typeof content === 'string') {
    return content;
  }
  return content
    .filter((part) => (part.type ? part.type === 'text' : true))
    .map((part) => part.text ?? '')
    .join('\n')
    .trim();
};

const tryParseToolCallFromText = (text: string): ComputerUseToolCall | undefined => {
  if (!text) {
    return undefined;
  }

  const toolCallMatch = text.match(/<tool_call>\s*([\s\S]+?)\s*<\/tool_call>/i);
  const candidate = toolCallMatch ? toolCallMatch[1] : text;

  try {
    const parsed = JSON.parse(candidate) as { name?: string; arguments?: unknown };
    if (!parsed) {
      return undefined;
    }
    const name = typeof parsed.name === 'string' ? parsed.name : 'computer_use';
    const args = parsed.arguments ?? parsed;
    if (typeof args !== 'object' || args === null) {
      return undefined;
    }
    return {
      name,
      arguments: args as ComputerUseArguments
    };
  } catch (error) {
    console.debug('Unable to parse tool call from text payload.', error);
    return undefined;
  }
};

const parseToolCall = (
  message: ChatCompletionResponse['choices'] extends Array<infer Choice>
    ? Choice extends { message?: infer Message }
      ? Message
      : never
    : never
): ComputerUseToolCall | undefined => {
  if (!message) {
    return undefined;
  }
  const toolCall = message.tool_calls?.[0];
  if (toolCall?.function?.arguments) {
    try {
      const parsedArgs = JSON.parse(toolCall.function.arguments) as ComputerUseArguments;
      return {
        name: toolCall.function.name ?? 'computer_use',
        arguments: parsedArgs
      };
    } catch (error) {
      console.debug('Failed to parse structured tool call arguments.', error);
    }
  }

  const text = gatherMessageText(message.content);
  return tryParseToolCallFromText(text);
};

const buildSystemPrompt = (width: number, height: number) =>
  [
    'You are the Enigma OS autopilot and control a virtual machine for the operator.',
    'Always analyse the screenshot before acting.',
    `The framebuffer corresponds to a display of ${width}x${height} pixels.`,
    'When you decide the next interaction, call the computer_use tool with your reasoning.',
    'Never emit raw prose as the final answer – only tool calls with actionable coordinates or text.'
  ].join(' ');

export const requestComputerUseAction = async (
  options: RequestComputerUseActionOptions
): Promise<LmStudioCompletion> => {
  const {
    objective,
    screenshotDataUrl,
    baseUrl,
    model,
    temperature,
    maxOutputTokens,
    display,
    fetchImplementation,
    headers
  } = options;

  const config = resolveDefaultLmStudioConfig();
  const endpoint = stripTrailingSlash(baseUrl ?? config.baseUrl);
  const resolvedModel = model ?? config.model;
  const resolvedTemperature = typeof temperature === 'number' ? temperature : config.temperature;
  const resolvedMaxTokens = typeof maxOutputTokens === 'number' ? maxOutputTokens : config.maxOutputTokens;
  const resolvedDisplay = {
    width: display?.width ?? config.displayWidth,
    height: display?.height ?? config.displayHeight
  };

  const payload = {
    model: resolvedModel,
    temperature: resolvedTemperature,
    max_tokens: resolvedMaxTokens,
    messages: [
      {
        role: 'system',
        content: [{ type: 'text', text: buildSystemPrompt(resolvedDisplay.width, resolvedDisplay.height) }]
      },
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: ensureDataUrl(screenshotDataUrl) }
          },
          {
            type: 'text',
            text: `Objective: ${objective}. Respond by calling the computer_use tool with an action and reasoning.`
          }
        ]
      }
    ],
    tools: [COMPUTER_USE_TOOL],
    tool_choice: 'auto'
  };

  const fetchFn = fetchImplementation ?? globalThis.fetch;
  if (!fetchFn) {
    throw new Error('Fetch API is not available in the current environment.');
  }

  const response = await fetchFn(`${endpoint}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...headers
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const message = await safeReadError(response);
    throw new Error(`LM Studio request failed with status ${response.status}: ${message}`);
  }

  const data = (await response.json()) as ChatCompletionResponse;
  const choice = data.choices?.[0];
  const message = choice?.message;
  const rawText = gatherMessageText(message?.content);
  const toolCall = parseToolCall(message);

  return {
    rawText,
    finishReason: choice?.finish_reason ?? null,
    toolCall,
    rawResponse: data
  };
};

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const safeReadError = async (response: Response): Promise<string> => {
  try {
    const text = await response.text();
    return text || 'Unknown error';
  } catch {
    return 'Unknown error';
  }
};

export const summarizeToolCall = (toolCall?: ComputerUseToolCall): string => {
  if (!toolCall) {
    return 'No actionable tool call returned.';
  }

  const { action, coordinate, text, reasoning } = toolCall.arguments;
  const segments: string[] = [];
  segments.push(action);
  if (coordinate && typeof coordinate.x === 'number' && typeof coordinate.y === 'number') {
    const width = coordinate.referenceWidth ? `/${coordinate.referenceWidth}` : '';
    const height = coordinate.referenceHeight ? `/${coordinate.referenceHeight}` : '';
    segments.push(`@ (${Math.round(coordinate.x)}, ${Math.round(coordinate.y)})${width && height ? ` on ${width.slice(1)}x${height.slice(1)} screen` : ''}`);
  }
  if (text) {
    segments.push(`text="${text}"`);
  }
  if (reasoning) {
    segments.push(`reason: ${reasoning}`);
  }

  return segments.join(' | ');
};
