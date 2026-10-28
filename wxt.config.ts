import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => ({
    name: 'FormFillup',
    description: 'Fill job application forms from your locally stored profile.',
    permissions: ['storage', 'activeTab', 'scripting', 'sidePanel'],
    // LLM endpoints only. Pages are reached through activeTab + scripting on user action.
    host_permissions: [
      'https://generativelanguage.googleapis.com/*',
      'https://api.groq.com/*',
      'https://openrouter.ai/*',
    ],
    optional_host_permissions: ['<all_urls>'],
    ...(browser === 'firefox'
      ? { browser_specific_settings: { gecko: { id: 'formfillup@local' } } }
      : {}),
  }),
});
