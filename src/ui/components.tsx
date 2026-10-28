import { useId, type ButtonHTMLAttributes, type ReactNode } from 'react';

type Tone = 'default' | 'primary' | 'danger' | 'ghost';

export function Button({
  tone = 'default',
  busy,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: Tone; busy?: boolean }) {
  return (
    <button type="button" {...rest} className={`ff-btn ff-btn-${tone} ${rest.className ?? ''}`} disabled={rest.disabled || busy} aria-busy={busy || undefined}>
      {busy && <span className="ff-spinner" aria-hidden="true" />}
      {children}
    </button>
  );
}

export function Badge({ tone = 'neutral', children, title }: { tone?: 'neutral' | 'good' | 'warn' | 'bad' | 'info'; children: ReactNode; title?: string }) {
  return (
    <span className={`ff-badge ff-badge-${tone}`} title={title}>
      {children}
    </span>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`ff-card ${className ?? ''}`}>
      {(title || actions) && (
        <header className="ff-card-head">
          {title && <h3>{title}</h3>}
          {actions && <div className="ff-card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

export function Banner({ tone = 'info', children, live }: { tone?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode; live?: boolean }) {
  return (
    <div className={`ff-banner ff-banner-${tone}`} role={tone === 'error' ? 'alert' : live ? 'status' : undefined}>
      {children}
    </div>
  );
}

export interface FieldRenderProps {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}

export function Field({
  label,
  hint,
  error,
  className,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  className?: string;
  children: (p: FieldRenderProps) => ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-h`;
  const errId = `${id}-e`;
  const describedBy = [hint ? hintId : '', error ? errId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <div className={`ff-field ${error ? 'has-error' : ''} ${className ?? ''}`}>
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': describedBy, 'aria-invalid': error ? true : undefined })}
      {hint && !error && (
        <div className="ff-hint" id={hintId}>
          {hint}
        </div>
      )}
      {error && (
        <div className="ff-error" id={errId}>
          {error}
        </div>
      )}
    </div>
  );
}

interface TextProps {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  error?: string;
  type?: 'text' | 'email' | 'tel' | 'date' | 'password' | 'number' | 'url';
  lang?: string;
  maxLength?: number;
  placeholder?: string;
  inputMode?: 'numeric' | 'decimal' | 'tel' | 'email' | 'text';
  autoComplete?: string;
  disabled?: boolean;
  suggestions?: readonly string[];
  className?: string;
  min?: string;
  max?: string;
  trailing?: ReactNode;
}

export function TextField({ label, value, onChange, hint, error, suggestions, className, trailing, ...input }: TextProps) {
  const listId = useId();
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(p) => (
        <div className="ff-input-row">
          <input
            {...p}
            {...input}
            list={suggestions ? listId : undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
          {trailing}
          {suggestions && (
            <datalist id={listId}>
              {suggestions.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          )}
        </div>
      )}
    </Field>
  );
}

export function TextArea({
  label,
  value,
  onChange,
  hint,
  error,
  maxLength,
  rows = 3,
  className,
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  error?: string;
  maxLength?: number;
  rows?: number;
  className?: string;
}) {
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(p) => <textarea {...p} rows={rows} maxLength={maxLength} value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

export function Select({
  label,
  value,
  onChange,
  options,
  hint,
  error,
  className,
  emptyLabel = 'Select...',
}: {
  label: ReactNode;
  value: string;
  onChange: (v: string) => void;
  options: readonly string[] | readonly { value: string; label: string }[];
  hint?: ReactNode;
  error?: string;
  className?: string;
  emptyLabel?: string;
}) {
  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  // Never hide a stored value that is not in the list.
  const extra = value && !opts.some((o) => o.value === value) ? [{ value, label: `${value} (custom)` }] : [];
  return (
    <Field label={label} hint={hint} error={error} className={className}>
      {(p) => (
        <select {...p} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">{emptyLabel}</option>
          {[...opts, ...extra].map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

export function Toggle({
  label,
  checked,
  onChange,
  hint,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <div className="ff-toggle">
      <input id={id} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-describedby={hint ? `${id}-h` : undefined} />
      <label htmlFor={id}>{label}</label>
      {hint && (
        <div className="ff-hint" id={`${id}-h`}>
          {hint}
        </div>
      )}
    </div>
  );
}
