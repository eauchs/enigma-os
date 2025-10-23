export const DEFAULT_LM_STUDIO_BASE_URL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_LM_STUDIO_BASE_URL) || 'http://127.0.0.1:1234';

export const DEFAULT_LM_STUDIO_MODEL =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_LM_STUDIO_MODEL) || 'apriel-1.5-15b-thinker@q2_k_xl';

export const DEFAULT_VLM_TEMPERATURE = 0.2;
export const DEFAULT_VLM_MAX_OUTPUT_TOKENS = 1536;
export const DEFAULT_VLM_DISPLAY_WIDTH = 1280;
export const DEFAULT_VLM_DISPLAY_HEIGHT = 720;

export interface LmStudioEndpointConfig {
  baseUrl: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  displayWidth: number;
  displayHeight: number;
}

const stripTrailingSlash = (value: string) => value.replace(/\/+$/, '');

export const resolveDefaultLmStudioConfig = (): LmStudioEndpointConfig => ({
  baseUrl: stripTrailingSlash(DEFAULT_LM_STUDIO_BASE_URL),
  model: DEFAULT_LM_STUDIO_MODEL,
  temperature: DEFAULT_VLM_TEMPERATURE,
  maxOutputTokens: DEFAULT_VLM_MAX_OUTPUT_TOKENS,
  displayWidth: DEFAULT_VLM_DISPLAY_WIDTH,
  displayHeight: DEFAULT_VLM_DISPLAY_HEIGHT
});
