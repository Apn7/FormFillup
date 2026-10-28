import { useRef, useState } from 'react';
import type { Profile, Settings } from '@/shared/types';
import { sendToBackground } from '@/shared/messages';
import { Banner, Button, Card } from '@/ui';
import { ACCEPT_ATTR, checkFiles, fileToBase64, formatSize, guessMime, MAX_TOTAL_BYTES, shrinkImage } from '@/ui/files';
import { DOCS_PRIVACY } from '@/ui/profileData';
import { applyReview, buildReviewRows, type ReviewRow } from '@/ui/reviewDiff';

interface Props {
  profile: Profile;
  settings: Settings | null;
  onApply: (p: Profile) => void;
  goToAi: () => void;
}

export function ImportPanel({ profile, settings, onApply, goToAi }: Props) {
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rows, setRows] = useState<ReviewRow[] | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const noAi = !settings || settings.llm.provider === 'none' || !settings.llm.apiKey;
  const total = files.reduce((n, f) => n + f.size, 0);

  const add = async (list: FileList | File[]) => {
    // Phone photos are 3-7 MB each; shrink them first so the size limit applies to what is actually sent.
    const prepared = await Promise.all(Array.from(list).map((f) => shrinkImage(f).catch(() => f)));
    const { accepted, errors: errs } = checkFiles(files, prepared);
    setFiles((current) => [...current, ...accepted]);
    setErrors(errs);
  };

  const extract = async () => {
    setBusy(true);
    setError('');
    setApplied(false);
    try {
      const payload = await Promise.all(
        files.map(async (f) => ({ name: f.name, mimeType: guessMime(f), base64: await fileToBase64(f) })),
      );
      const res = await sendToBackground('ff:extract-profile', { files: payload });
      const r = buildReviewRows(profile, res.profile);
      setRows(r);
      setNotes(res.notes ?? []);
      setSelected(new Set(r.filter((x) => x.checked).map((x) => x.path)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!rows) return;
    onApply(applyReview(profile, rows, selected));
    setApplied(true);
    setRows(null);
    setFiles([]);
  };

  const toggle = (path: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(path);
      else n.delete(path);
      return n;
    });

  return (
    <>
      <Banner tone="warn">
        <strong>Privacy:</strong> {DOCS_PRIVACY}
      </Banner>
      {noAi && (
        <Banner tone="info">
          No AI provider is configured. <a href="#ai" onClick={(e) => { e.preventDefault(); goToAi(); }}>Set one up in AI settings</a> first.
        </Banner>
      )}
      {applied && <Banner tone="success" live>Applied and saved. Review the result in the Profile section.</Banner>}

      {!rows && (
        <Card title="Documents">
          <div
            className={`op-drop ${over ? 'over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true); }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); add(e.dataTransfer.files); }}
          >
            <p style={{ marginTop: 0 }}>Drag CV, NID, certificates here (PDF, JPG, PNG, WEBP; up to {formatSize(MAX_TOTAL_BYTES)} total)</p>
            <Button onClick={() => input.current?.click()}>Choose files</Button>
            <input ref={input} type="file" multiple accept={ACCEPT_ATTR} className="ff-sr" aria-label="Choose documents" tabIndex={-1}
              onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ''; }} />
          </div>
          {errors.length > 0 && <Banner tone="error"><ul>{errors.map((m, i) => <li key={i}>{m}</li>)}</ul></Banner>}
          {files.length > 0 && (
            <ul className="op-files">
              {files.map((f, i) => (
                <li key={`${f.name}-${f.size}`}>
                  <span>{f.name}</span>
                  <span className="ff-muted">{formatSize(f.size)}</span>
                  <Button tone="ghost" className="ff-btn-small" onClick={() => setFiles(files.filter((_, j) => j !== i))} aria-label={`Remove ${f.name}`}>Remove</Button>
                </li>
              ))}
              <li><strong>Total {formatSize(total)}</strong> of {formatSize(MAX_TOTAL_BYTES)}</li>
            </ul>
          )}
          {error && <Banner tone="error">{error}</Banner>}
          <div className="op-row" aria-live="polite">
            <Button tone="primary" onClick={extract} busy={busy} disabled={files.length === 0 || noAi}>Extract details</Button>
            {busy && <span className="ff-muted">Sending to your AI provider...</span>}
          </div>
        </Card>
      )}

      {rows && (
        <Card
          title="Review extracted details"
          actions={<Button onClick={() => setRows(null)}>Back</Button>}
        >
          {notes.length > 0 && (
            <Banner tone="info"><strong>Notes from the AI</strong><ul>{notes.map((n, i) => <li key={i}>{n}</li>)}</ul></Banner>
          )}
          {rows.length === 0 ? (
            <p>Nothing new was found that differs from your profile.</p>
          ) : (
            <>
              <p className="ff-muted">Fields that are empty in your profile are ticked. Tick others to overwrite them. Always check AI output against your documents.</p>
              <div className="op-row" style={{ marginBottom: 8 }}>
                <Button className="ff-btn-small" onClick={() => setSelected(new Set(rows.map((r) => r.path)))}>Select all</Button>
                <Button className="ff-btn-small" onClick={() => setSelected(new Set())}>Select none</Button>
              </div>
              <table className="op-table">
                <thead><tr><th scope="col">Use</th><th scope="col">Field</th><th scope="col">Current</th><th scope="col">Extracted</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.path}>
                      <td><input type="checkbox" checked={selected.has(r.path)} onChange={(e) => toggle(r.path, e.target.checked)} aria-label={`Use extracted ${r.label}`} /></td>
                      <td>{r.label}</td>
                      <td className={r.current ? '' : 'empty'}>{r.current || '(empty)'}</td>
                      <td>{r.extracted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
          <div className="op-row" style={{ marginTop: 12 }}>
            <Button tone="primary" onClick={apply} disabled={selected.size === 0}>Apply {selected.size} selected</Button>
          </div>
        </Card>
      )}
    </>
  );
}
