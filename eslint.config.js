import js from '@eslint/js';
import vitest from 'eslint-plugin-vitest';
import testingLibrary from 'eslint-plugin-testing-library';
import jestDom from 'eslint-plugin-jest-dom';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

const projectConfig = tseslint.config({
  files: ['**/*.{ts,tsx}'],
  languageOptions: {
    parserOptions: {
      projectService: true,
      tsconfigRootDir: import.meta.dirname,
      sourceType: 'module'
    }
  },
  settings: {
    react: {
      version: 'detect'
    }
  },
  plugins: {
    react,
    'react-hooks': reactHooks,
    'testing-library': testingLibrary,
    'jest-dom': jestDom,
    vitest
  },
  rules: {
    ...react.configs.flat.recommended.rules,
    ...reactHooks.configs.recommended.rules,
    ...testingLibrary.configs['flat/react'].rules,
    ...jestDom.configs['flat/recommended'].rules,
    'react/react-in-jsx-scope': 'off',
    '@typescript-eslint/no-explicit-any': 'warn'
  }
});

const e2eOverride = {
  files: ['tests/e2e/**/*.ts'],
  rules: {
    'testing-library/no-node-access': 'off',
    'testing-library/no-container': 'off',
    'testing-library/prefer-screen-queries': 'off',
    'testing-library/prefer-find-by': 'off',
    'testing-library/no-unnecessary-act': 'off'
  }
};

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  projectConfig,
  e2eOverride,
  vitest.configs.recommended
);
