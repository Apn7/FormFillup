import { useRef, useState } from 'react';
import type { Profile } from '@/shared/types';
import { emptyProfile, mergeProfile } from '@/shared/profile';
import { clearSiteMappings } from '@/lib/storage';
import { Banner, Button, Card } from '@/ui';
import { normalizeProfile, parseProfileJson } from '@/ui/profileJson';

export function DataPanel({ profile, onReplace, onClearAll }: { profile: Profile; onReplace: (p: Profile) => void; onClearAll: () => Promise<void> }) {
  const [msg, setMsg] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  const exportJson = () => {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'formfillup-profile.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const importJson = async (f: File) => {
    try {
      const parsed = parseProfileJson(await f.text());
      onReplace(normalizeProfile(mergeProfile(emptyProfile(), parsed)));
      setMsg({ tone: 'success', text: 'Profile imported and saved.' });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const forgetMappings = async () => {
    try {
      await clearSiteMappings();
      setMsg({ tone: 'success', text: 'Learned site mappings cleared.' });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
  };

  const clear = async () => {
    try {
      await onClearAll();
      setMsg({ tone: 'success', text: 'All FormFillup data was erased from this browser.' });
    } catch (e) {
      setMsg({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    }
    setConfirming(false);
  };

  return (
    <>
      <div aria-live="polite">{msg && <Banner tone={msg.tone} live>{msg.text}</Banner>}</div>
      <Card title="Export">
        <p>Download your profile as a JSON file. It contains personal data; keep it somewhere safe. Your API key is not included.</p>
        <Button onClick={exportJson}>Export profile JSON</Button>
      </Card>
      <Card title="Import">
        <p>Load a previously exported file. It replaces matching fields; anything the file omits keeps default values.</p>
        <Button onClick={() => file.current?.click()}>Import profile JSON</Button>
        <input ref={file} type="file" accept="application/json,.json" className="ff-sr" tabIndex={-1} aria-label="Choose profile JSON"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void importJson(f); e.target.value = ''; }} />
      </Card>
      <Card title="Learned site mappings">
        <p>FormFillup remembers which field means what on sites you have filled, so repeat visits skip the AI. Clear this if a site changed its form and fills go to the wrong fields.</p>
        <Button onClick={() => void forgetMappings()}>Clear learned mappings</Button>
      </Card>
      <Card title="Erase everything">
        <p>Deletes your profile, AI settings (including the API key) and learned site mappings from this browser. This cannot be undone.</p>
        {confirming ? (
          <div className="op-row" role="alertdialog" aria-label="Confirm erase">
            <strong>Really erase all data?</strong>
            <Button tone="danger" onClick={clear}>Yes, erase</Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        ) : (
          <Button tone="danger" onClick={() => setConfirming(true)}>Clear all data</Button>
        )}
      </Card>
    </>
  );
}
