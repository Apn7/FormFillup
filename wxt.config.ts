import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ browser }) => ({
    name: 'FormFillup',
    description: 'Fill job application forms from your locally stored profile.',
    permissions: ['storage', 'activeTab', 'scripting'],
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
  hooks: {
    // The content script is registered at runtime and injected via activeTab on click, so it needs no
    // standing host access. WXT copies its `matches` into host_permissions; take that back out.
    'build:manifestGenerated': (_wxt, manifest) => {
      manifest.host_permissions = manifest.host_permissions?.filter((p: string) => p !== '<all_urls>');
      if (manifest.manifest_version === 2) {
        manifest.permissions = manifest.permissions?.filter((p: string) => p !== '<all_urls>');
      }
    },
  },
});
