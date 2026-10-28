import { useEffect, useState } from 'react';
import type { Profile, Settings } from '@/shared/types';
import { emptyProfile } from '@/shared/profile';
import { getProfile, getSettings, saveProfile } from '@/lib/storage';
import { Banner, Button } from '@/ui';
import { useAutosave } from '@/ui/useAutosave';
import { normalizeProfile } from '@/ui/profileJson';
import { ProfileEditor } from './ProfileEditor';
import { ImportPanel } from './ImportPanel';
import { AiSettings } from './AiSettings';
import { DataPanel } from './DataPanel';

type Section = 'profile' | 'import' | 'ai' | 'data';
const NAV: { id: Section; label: string }[] = [
  { id: 'profile', label: 'Profile' },
  { id: 'import', label: 'Import from documents' },
  { id: 'ai', label: 'AI settings' },
  { id: 'data', label: 'Data' },
];

function sectionFromHash(): Section {
  const h = location.hash.slice(1);
  return NAV.some((n) => n.id === h) ? (h as Section) : 'profile';
}

export function App() {
  const [section, setSection] = useState<Section>(sectionFromHash);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState('');
  const autosave = useAutosave<Profile>(saveProfile);

  const load = () => {
    setLoadError('');
    Promise.all([getProfile(), getSettings()]).then(
      ([p, s]) => {
        setProfile(normalizeProfile(p));
        setSettings(s);
      },
      (e: unknown) => setLoadError(e instanceof Error ? e.message : String(e)),
    );
  };
  useEffect(load, []);

  useEffect(() => {
    const onHash = () => setSection(sectionFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const go = (s: Section) => {
    location.hash = s;
    setSection(s);
  };

  const changeProfile = (p: Profile) => {
    setProfile(p);
    autosave.queue(p);
  };

  const clearAll = async () => {
    autosave.cancel();
    await browser.storage.local.clear();
    setProfile(emptyProfile());
    const s = await getSettings();
    setSettings(s);
  };

  // Never render an editor over data that failed to load: editing then saving would overwrite the real profile.
  if (loadError)
    return (
      <main className="op-main">
        <Banner tone="error">Could not load your saved data, so editing is disabled to protect it: {loadError}</Banner>
        <Button onClick={load}>Retry</Button>
      </main>
    );
  if (!profile || !settings)
    return (
      <main className="op-main" aria-busy="true">
        <p className="ff-muted">Loading...</p>
      </main>
    );

  const title = NAV.find((n) => n.id === section)!.label;
  return (
    <div className="op">
      <nav className="op-nav" aria-label="Sections">
        <h1>FormFillup</h1>
        {NAV.map((n) => (
          <button key={n.id} type="button" aria-current={section === n.id ? 'page' : undefined} onClick={() => go(n.id)}>
            {n.label}
          </button>
        ))}
      </nav>
      <main className="op-main">
        <header>
          <h2>{title}</h2>
          {section === 'profile' && (
            <div className={`op-saved ${autosave.state === 'error' ? 'err' : ''}`} role="status" aria-live="polite">
              {autosave.state === 'saving' && 'Saving...'}
              {autosave.state === 'saved' && 'Saved'}
              {autosave.state === 'error' && `Not saved: ${autosave.error}`}
            </div>
          )}
        </header>
        {section === 'profile' && (
          <>
            <p className="ff-muted">Changes save automatically. Everything stays in this browser.</p>
            <ProfileEditor profile={profile} onChange={changeProfile} />
          </>
        )}
        {section === 'import' && <ImportPanel profile={profile} settings={settings} onApply={changeProfile} goToAi={() => go('ai')} />}
        {section === 'ai' && <AiSettings settings={settings} onChange={setSettings} />}
        {section === 'data' && <DataPanel profile={profile} onReplace={changeProfile} onClearAll={clearAll} />}
      </main>
    </div>
  );
}
