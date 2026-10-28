import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FillReport, PreviewResult, Profile, Settings } from '@/shared/types';
import { sendToTab } from '@/shared/messages';
import { emptyProfile } from '@/shared/profile';
import { getProfile, getSettings } from '@/lib/storage';
import { ensureContentScript } from '@/lib/engine/inject';
import { Badge, Banner, Button, Toggle } from '@/ui';
import { confidenceTone, friendlyError, groupBySection, hostnameOf, initialSelection, isRestrictedUrl, SOURCE_LABEL } from './scan';

type Phase = 'idle' | 'scanning' | 'preview' | 'filling' | 'done';

function isProfileEmpty(p: Profile): boolean {
  const e = emptyProfile();
  return (
    JSON.stringify({ ...p, personal: { ...p.personal, nationality: '' } }) ===
    JSON.stringify({ ...e, personal: { ...e.personal, nationality: '' } })
  );
}

export function App() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState('');
  const [tab, setTab] = useState<{ id?: number; url?: string } | null>(null);
  const [useLlm, setUseLlm] = useState(false);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [report, setReport] = useState<FillReport | null>(null);
  const tabIdRef = useRef<number | undefined>(undefined);
  const scannedRef = useRef(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [p, s, tabs] = await Promise.all([
          getProfile(),
          getSettings(),
          browser.tabs.query({ active: true, currentWindow: true }),
        ]);
        if (!alive) return;
        setProfile(p);
        setSettings(s);
        setUseLlm(s.useLlmForMapping && s.llm.provider !== 'none' && !!s.llm.apiKey);
        const t = tabs[0];
        setTab({ id: t?.id, url: t?.url });
        tabIdRef.current = t?.id;
      } catch (e) {
        if (alive) setLoadError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Popups close on blur: remove page highlights best-effort when that happens.
  useEffect(() => {
    const clear = () => {
      const id = tabIdRef.current;
      if (id !== undefined && scannedRef.current) void sendToTab(id, 'ff:clear-highlights', {}).catch(() => undefined);
    };
    window.addEventListener('pagehide', clear);
    return () => window.removeEventListener('pagehide', clear);
  }, []);

  const llmAvailable = !!settings && settings.llm.provider !== 'none' && !!settings.llm.apiKey;
  const restricted = tab ? isRestrictedUrl(tab.url) : false;
  const host = hostnameOf(tab?.url);

  const openOptions = useCallback(() => {
    void browser.runtime.openOptionsPage();
    window.close();
  }, []);

  const scan = useCallback(async () => {
    if (tab?.id === undefined) return;
    setError('');
    setReport(null);
    setPhase('scanning');
    try {
      await ensureContentScript(tab.id);
      scannedRef.current = true;
      const result = await sendToTab(tab.id, 'ff:preview', { useLlm: useLlm && llmAvailable });
      setPreview(result);
      setSelected(initialSelection(result.plan));
      setPhase('preview');
    } catch (e) {
      setError(friendlyError(e));
      setPhase('idle');
    }
  }, [tab, useLlm, llmAvailable]);

  const chosen = useMemo(() => (preview ? preview.plan.filter((p) => selected[p.fid]) : []), [preview, selected]);

  const fill = useCallback(async () => {
    if (tab?.id === undefined || !preview) return;
    setError('');
    setPhase('filling');
    try {
      const res = await sendToTab(tab.id, 'ff:fill', { items: chosen.map((p) => ({ ...p, enabled: true })) });
      setReport(res);
      setPhase('done');
    } catch (e) {
      setError(friendlyError(e));
      setPhase('preview');
    }
  }, [tab, preview, chosen]);

  if (loadError)
    return (
      <main className="pp">
        <Banner tone="error">Could not load your data: {loadError}</Banner>
      </main>
    );
  if (!profile || !settings || !tab)
    return (
      <main className="pp" aria-busy="true">
        <p className="ff-muted">Loading...</p>
      </main>
    );

  const labelOf = new Map(preview?.plan.map((p) => [p.fid, p.label]) ?? []);

  return (
    <main className="pp">
      <header className="pp-head">
        <div>
          <h1>FormFillup</h1>
          <div className="pp-site" title={tab.url}>{host || 'No page'}</div>
        </div>
        <Button tone="ghost" onClick={openOptions} aria-label="Open options">
          Options
        </Button>
      </header>

      {isProfileEmpty(profile) ? (
        <div className="pp-empty">
          <h2>Set up your profile</h2>
          <p>Add your details once; FormFillup fills them into job forms on your command. Everything stays in this browser.</p>
          <Button tone="primary" onClick={openOptions}>
            Set up your profile
          </Button>
        </div>
      ) : (
        <>
          {restricted && <Banner tone="warn">This page can't be filled. Open the application form in this tab first.</Banner>}
          <Toggle
            label="Use AI for unknown fields"
            checked={useLlm && llmAvailable}
            onChange={setUseLlm}
            disabled={!llmAvailable}
            hint={
              llmAvailable
                ? 'Sends field labels and option texts only, never your data.'
                : 'Add an API key in Options > AI settings to enable.'
            }
          />
          <div className="pp-actions">
            <Button tone="primary" onClick={scan} busy={phase === 'scanning'} disabled={restricted || phase === 'filling'}>
              {phase === 'scanning' ? 'Scanning...' : preview ? 'Rescan this page' : 'Scan this page'}
            </Button>
          </div>
        </>
      )}

      <div aria-live="polite">
        {phase === 'scanning' && <Banner tone="info" live>Scanning the page{useLlm && llmAvailable ? ' and asking AI about unknown fields' : ''}...</Banner>}
        {phase === 'filling' && <Banner tone="info" live>Filling fields...</Banner>}
      </div>
      {error && <Banner tone="error">{error}</Banner>}

      {preview && phase !== 'scanning' && (
        <>
          {preview.warnings.length > 0 && (
            <Banner tone="warn">
              <strong>Warnings</strong>
              <ul>{preview.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </Banner>
          )}
          {preview.plan.length === 0 ? (
            <Banner tone="warn">Nothing to fill on this page. If it has a form, make sure it is visible and try again.</Banner>
          ) : (
            groupBySection(preview.plan).map(([section, items]) => (
              <section className="pp-section" key={section} aria-label={section}>
                <h2>{section}</h2>
                <ul className="pp-list">
                  {items.map((it) => {
                    const id = `pp-${it.fid}`;
                    const on = !!selected[it.fid];
                    return (
                      <li key={it.fid} className={`pp-item ${on ? '' : 'off'}`}>
                        <input
                          id={id}
                          type="checkbox"
                          checked={on}
                          disabled={phase === 'filling'}
                          onChange={(e) => setSelected((s) => ({ ...s, [it.fid]: e.target.checked }))}
                        />
                        <label htmlFor={id}>{it.label || it.key}</label>
                        <span className="pp-badges">
                          <Badge tone="info">{SOURCE_LABEL[it.source] ?? it.source}</Badge>
                          <Badge tone={confidenceTone(it.confidence)} title="Match confidence">
                            {Math.round(it.confidence * 100)}%
                          </Badge>
                        </span>
                        <div className="pp-value">{it.displayValue || <em>(empty)</em>}</div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))
          )}

          {preview.unmatched.length > 0 && (
            <details className="pp-unmatched">
              <summary>Not filled ({preview.unmatched.length})</summary>
              <ul className="pp-list">
                {preview.unmatched.map((u) => (
                  <li key={u.fid} className="pp-item" style={{ gridTemplateColumns: '1fr' }}>
                    <strong>{u.label || u.fid}</strong>
                    <span className="pp-value" style={{ gridColumn: 1 }}>{u.section ? `${u.section} - ` : ''}{u.reason}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {report && (
            <div className="pp-result" aria-live="polite">
              <Banner tone={report.failed ? 'warn' : 'success'} live>
                Filled {report.filled} field{report.filled === 1 ? '' : 's'}
                {report.failed ? `, ${report.failed} failed` : ''}.
              </Banner>
              {report.failed > 0 && (
                <ul>
                  {report.items.filter((i) => i.status === 'failed').map((i) => (
                    <li key={i.fid} className="failed">{labelOf.get(i.fid) ?? i.key}: {i.reason ?? 'failed'}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {preview.plan.length > 0 && (
            <div className="pp-sticky">
              <Button tone="primary" style={{ width: '100%' }} onClick={fill} busy={phase === 'filling'} disabled={chosen.length === 0}>
                Fill {chosen.length} field{chosen.length === 1 ? '' : 's'}
              </Button>
              <p className="pp-note">Check every value, solve the captcha and submit yourself.</p>
            </div>
          )}
        </>
      )}
    </main>
  );
}
