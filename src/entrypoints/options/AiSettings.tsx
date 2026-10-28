import { useState } from 'react';
import type { LlmProvider, Settings } from '@/shared/types';
import { sendToBackground } from '@/shared/messages';
import { saveSettings } from '@/lib/storage';
import { Banner, Button, Card, Select, TextField, Toggle } from '@/ui';

const PRESETS = [
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' },
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'google/gemini-2.0-flash-exp:free' },
];

/** Hosts declared in the manifest; anything else (e.g. local Ollama) needs an optional permission at runtime. */
const BUILT_IN_HOSTS = ['generativelanguage.googleapis.com', 'api.groq.com', 'openrouter.ai'];

async function ensureHostPermission(baseUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error('Base URL is not a valid URL.');
  }
  if (BUILT_IN_HOSTS.includes(url.hostname)) return true;
  // request() resolves true without prompting when already granted; no contains() first, which would cost the gesture.
  return browser.permissions.request({ origins: [`${url.protocol}//${url.hostname}/*`] });
}

export function AiSettings({ settings, onChange }: { settings: Settings; onChange: (s: Settings) => void }) {
  const [draft, setDraft] = useState<Settings>(settings);
  const [showKey, setShowKey] = useState(false);
  const [busy, setBusy] = useState<'' | 'save' | 'test'>('');
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);
  const llm = draft.llm;
  const setLlm = (patch: Partial<Settings['llm']>) => setDraft({ ...draft, llm: { ...llm, ...patch } });
  const needsBase = llm.provider === 'openai-compatible';
  const hasAi = llm.provider !== 'none';

  const persist = async () => {
    const clean: Settings = {
      ...draft,
      llm: { ...llm, apiKey: llm.apiKey.trim(), model: llm.model.trim(), baseUrl: llm.baseUrl.trim() },
      useLlmForMapping: draft.useLlmForMapping && hasAi,
      dependentFieldTimeoutMs: Math.min(30000, Math.max(200, Math.round(draft.dependentFieldTimeoutMs) || 2000)),
    };
    await saveSettings(clean);
    setDraft(clean);
    onChange(clean);
  };

  const run = async (kind: 'save' | 'test') => {
    setBusy(kind);
    setMsg(null);
    try {
      // Must be the first await: permission prompts need the click's user gesture.
      if (needsBase && !(await ensureHostPermission(llm.baseUrl.trim()))) {
        throw new Error('Permission to contact that base URL was not granted.');
      }
      await persist();
      if (kind === 'test') {
        const r = await sendToBackground('ff:llm-test', {});
        setMsg({ tone: r.ok ? 'success' : 'error', text: r.detail });
      } else setMsg({ tone: 'success', text: 'Settings saved.' });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy('');
    }
  };

  return (
    <>
      <Card title="Provider">
        <div className="ff-grid">
          <Select
            label="AI provider"
            value={llm.provider}
            emptyLabel="None"
            options={[
              { value: 'gemini', label: 'Google Gemini' },
              { value: 'openai-compatible', label: 'OpenAI-compatible (Groq, OpenRouter, Ollama...)' },
              { value: 'none', label: 'None (rules only)' },
            ]}
            onChange={(v) => setLlm({ provider: (v || 'none') as LlmProvider })}
          />
          {hasAi && (
            <>
              <TextField
                label="API key"
                type={showKey ? 'text' : 'password'}
                autoComplete="off"
                value={llm.apiKey}
                onChange={(v) => setLlm({ apiKey: v })}
                hint={llm.provider === 'gemini' ? (
                  <>Free key: <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com/apikey</a></>
                ) : 'Stored only in this browser.'}
                trailing={<Button onClick={() => setShowKey(!showKey)} aria-pressed={showKey}>{showKey ? 'Hide' : 'Show'}</Button>}
              />
              <TextField label="Model" value={llm.model} onChange={(v) => setLlm({ model: v })} hint="Free-tier model names change; edit if requests fail." suggestions={llm.provider === 'gemini' ? ['gemini-flash-latest', 'gemini-2.5-flash'] : undefined} />
              {needsBase && (
                <div>
                  <TextField label="Base URL" type="url" value={llm.baseUrl} onChange={(v) => setLlm({ baseUrl: v })} placeholder="https://api.groq.com/openai/v1" />
                  <div className="op-presets" role="group" aria-label="Presets">
                    {PRESETS.map((p) => (
                      <Button key={p.name} className="ff-btn-small" onClick={() => setLlm({ baseUrl: p.baseUrl, model: p.model })}>{p.name}</Button>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
        {needsBase && <Banner tone="info">Custom hosts may need extra browser permission. The extension requests it when needed; built-in presets are pre-approved.</Banner>}
      </Card>

      <Card title="Behaviour">
        <Toggle
          label="Use AI for unknown fields"
          checked={draft.useLlmForMapping && hasAi}
          disabled={!hasAi}
          onChange={(v) => setDraft({ ...draft, useLlmForMapping: v })}
          hint="Default for the popup toggle."
        />
        <div style={{ marginTop: 12, maxWidth: 280 }}>
          <TextField
            label="Dependent field timeout (ms)"
            type="number"
            inputMode="numeric"
            value={String(draft.dependentFieldTimeoutMs)}
            onChange={(v) => setDraft({ ...draft, dependentFieldTimeoutMs: Number(v) })}
            hint="How long to wait for dropdowns such as upazila to load after choosing a district."
          />
        </div>
      </Card>

      <Card title="What is sent, and when">
        <ul>
          <li><strong>Field mapping</strong> (only when the toggle is on and you press Scan): field labels, names and dropdown option texts from the page. Never your profile values.</li>
          <li><strong>Document import</strong> (only when you press Extract): the files you selected, in full, so the AI can read them.</li>
          <li>Requests go directly from your browser to the provider with your own key. There is no FormFillup server.</li>
        </ul>
      </Card>

      <div className="op-row" aria-live="polite">
        <Button tone="primary" onClick={() => run('save')} busy={busy === 'save'} disabled={!dirty || !!busy}>Save settings</Button>
        <Button onClick={() => run('test')} busy={busy === 'test'} disabled={!hasAi || !llm.apiKey || !!busy}>Save and test connection</Button>
        {dirty && !busy && <span className="ff-muted">Unsaved changes</span>}
      </div>
      {msg && <Banner tone={msg.tone} live>{msg.text}</Banner>}
    </>
  );
}
