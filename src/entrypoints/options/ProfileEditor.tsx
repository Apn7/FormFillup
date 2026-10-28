import type { Address, EducationLevel, EducationRecord, JobRecord, Profile } from '@/shared/types';
import { EDUCATION_LEVELS, EDUCATION_LEVEL_LABELS, emptyEducation, emptyJob } from '@/shared/profile';
import { Button, Card, Select, TextArea, TextField, Toggle } from '@/ui';
import { setPath } from '@/ui/paths';
import {
  BLOOD_GROUPS, BOARDS, DEPARTMENTAL, DURATIONS, EMPLOYMENT_TYPES, EXAMS, GENDERS, GROUPS, MARITAL, QUOTAS, RELIGIONS, SCALES,
} from '@/ui/profileData';
import {
  validateDateRange, validateDuration, validateEmail, validateMobile, validateNid, validatePostCode, validateResult, validateYear,
} from '@/ui/validators';

interface Props {
  profile: Profile;
  onChange: (p: Profile) => void;
}

const ADDRESS_FIELDS: [keyof Address, string][] = [
  ['careOf', 'Care of'],
  ['village', 'Village / Road / House / Flat'],
  ['district', 'District'],
  ['upazila', 'Upazila / Police Station'],
  ['postOffice', 'Post office'],
  ['postCode', 'Post code'],
];

export function ProfileEditor({ profile, onChange }: Props) {
  /** Immutable update through a mutator on a deep copy. */
  const edit = (fn: (draft: Profile) => void) => {
    const next = structuredClone(profile);
    fn(next);
    onChange(next);
  };
  const set = (path: string) => (v: unknown) => edit((d) => setPath(d, path, v));
  const p = profile;

  return (
    <>
      <Card title="Personal">
        <div className="ff-grid">
          <TextField label="Full name (English)" value={p.personal.nameEn} onChange={set('personal.nameEn')} autoComplete="off" />
          <TextField label="Full name (Bangla)" lang="bn" value={p.personal.nameBn} onChange={set('personal.nameBn')} />
          <TextField label="Father's name (English)" value={p.personal.fatherEn} onChange={set('personal.fatherEn')} />
          <TextField label="Father's name (Bangla)" lang="bn" value={p.personal.fatherBn} onChange={set('personal.fatherBn')} />
          <TextField label="Mother's name (English)" value={p.personal.motherEn} onChange={set('personal.motherEn')} />
          <TextField label="Mother's name (Bangla)" lang="bn" value={p.personal.motherBn} onChange={set('personal.motherBn')} />
          <TextField label="Date of birth" type="date" value={p.personal.dob} onChange={set('personal.dob')} />
          <Select label="Gender" value={p.personal.gender} onChange={set('personal.gender')} options={GENDERS} />
          <Select label="Religion" value={p.personal.religion} onChange={set('personal.religion')} options={RELIGIONS} />
          <TextField label="Nationality" value={p.personal.nationality} onChange={set('personal.nationality')} suggestions={['Bangladeshi']} />
          <Select label="Marital status" value={p.personal.maritalStatus} onChange={set('personal.maritalStatus')} options={MARITAL} />
          {p.personal.maritalStatus === 'Married' && (
            <TextField label="Spouse name" value={p.personal.spouseName} onChange={set('personal.spouseName')} />
          )}
          <Select label="Blood group" value={p.personal.bloodGroup} onChange={set('personal.bloodGroup')} options={BLOOD_GROUPS} />
        </div>
      </Card>

      <Card title="Identity and contact">
        <div className="ff-grid">
          <TextField label="National ID" inputMode="numeric" value={p.ids.nid} onChange={set('ids.nid')} error={validateNid(p.ids.nid)} />
          <TextField label="Birth registration no" inputMode="numeric" value={p.ids.birthReg} onChange={set('ids.birthReg')} />
          <TextField label="Passport no" value={p.ids.passport} onChange={set('ids.passport')} maxLength={15} />
          <TextField
            label="Mobile"
            type="tel"
            inputMode="tel"
            maxLength={11}
            value={p.contact.mobile}
            onChange={set('contact.mobile')}
            error={validateMobile(p.contact.mobile)}
            hint="11 digits, e.g. 01712345678"
          />
          <TextField label="Email" type="email" inputMode="email" value={p.contact.email} onChange={set('contact.email')} error={validateEmail(p.contact.email)} />
        </div>
      </Card>

      <Card title="Quota and status">
        <div className="ff-grid">
          <Select label="Quota" value={p.quota} onChange={set('quota')} options={QUOTAS} />
          <TextField label="Quota details" value={p.quotaDetails} onChange={set('quotaDetails')} hint="Certificate or ID, if the form asks." />
          <Select label="Departmental status" value={p.departmentalStatus} onChange={set('departmentalStatus')} options={DEPARTMENTAL} />
        </div>
      </Card>

      <Card title="Present address">
        <AddressForm value={p.presentAddress} onChange={(a) => set('presentAddress')(a)} />
      </Card>

      <Card title="Permanent address">
        <Toggle
          label="Same as present address"
          checked={p.permanentSameAsPresent}
          onChange={(v) =>
            edit((d) => {
              d.permanentSameAsPresent = v;
              if (v) d.permanentAddress = { ...d.presentAddress };
            })
          }
        />
        <div style={{ marginTop: 12 }}>
          <AddressForm
            value={p.permanentSameAsPresent ? p.presentAddress : p.permanentAddress}
            disabled={p.permanentSameAsPresent}
            onChange={(a) => set('permanentAddress')(a)}
          />
        </div>
      </Card>

      <Card title="Education">
        {EDUCATION_LEVELS.map((lvl) => (
          <EducationCard
            key={lvl}
            level={lvl}
            record={p.education[lvl]}
            onChange={(r) =>
              edit((d) => {
                if (r) d.education[lvl] = r;
                else delete d.education[lvl];
              })
            }
          />
        ))}
      </Card>

      <Card
        title="Experience"
        actions={<Button onClick={() => edit((d) => void d.experience.push(emptyJob()))}>Add job</Button>}
      >
        {p.experience.length === 0 && <p className="ff-muted">No experience added. Leave empty if not applicable.</p>}
        {p.experience.map((job, i) => (
          <JobCard
            key={i}
            index={i}
            total={p.experience.length}
            job={job}
            onChange={(j) => edit((d) => void (d.experience[i] = j))}
            onRemove={() => edit((d) => void d.experience.splice(i, 1))}
            onMove={(dir) =>
              edit((d) => {
                const [x] = d.experience.splice(i, 1);
                if (x) d.experience.splice(i + dir, 0, x);
              })
            }
          />
        ))}
      </Card>

      <ExtraEditor extra={p.extra} onChange={(e) => set('extra')(e)} />
    </>
  );
}

function AddressForm({ value, onChange, disabled }: { value: Address; onChange: (a: Address) => void; disabled?: boolean }) {
  return (
    <div className="ff-grid">
      {ADDRESS_FIELDS.map(([k, label]) => (
        <TextField
          key={k}
          label={label}
          value={value[k]}
          disabled={disabled}
          inputMode={k === 'postCode' ? 'numeric' : undefined}
          maxLength={k === 'postCode' ? 4 : k === 'village' ? 150 : undefined}
          error={k === 'postCode' ? validatePostCode(value[k]) : ''}
          onChange={(v) => onChange({ ...value, [k]: v })}
        />
      ))}
    </div>
  );
}

function EducationCard({ level, record, onChange }: { level: EducationLevel; record: EducationRecord | undefined; onChange: (r: EducationRecord | undefined) => void }) {
  const title = EDUCATION_LEVEL_LABELS[level];
  if (!record) {
    return (
      <div className="op-list-item">
        <div className="ff-card-head">
          <h4>{title}</h4>
          <Button onClick={() => onChange(emptyEducation())} aria-label={`Add ${title}`}>Add</Button>
        </div>
      </div>
    );
  }
  const school = level === 'ssc' || level === 'hsc';
  const f = <K extends keyof EducationRecord>(k: K) => (v: EducationRecord[K]) => onChange({ ...record, [k]: v });
  return (
    <div className="op-list-item" role="group" aria-label={title}>
      <div className="ff-card-head">
        <h4>{title}</h4>
        <Button tone="danger" onClick={() => onChange(undefined)} aria-label={`Remove ${title}`}>Remove</Button>
      </div>
      <div className="ff-grid">
        <TextField label="Examination / Degree" value={record.exam} onChange={f('exam')} suggestions={EXAMS[level]} />
        {school ? (
          <>
            <TextField label="Board" value={record.board} onChange={f('board')} suggestions={BOARDS} />
            <TextField label="Group" value={record.group} onChange={f('group')} suggestions={GROUPS} />
          </>
        ) : (
          <>
            <TextField label="University / Institute" value={record.institute} onChange={f('institute')} />
            <TextField label="Subject" value={record.subject} onChange={f('subject')} />
          </>
        )}
        <TextField label="Roll no" inputMode="numeric" value={record.roll} onChange={f('roll')} />
        <TextField label="Registration no" value={record.registration} onChange={f('registration')} />
        <Select label="Result scale" value={record.resultScale} onChange={(v) => f('resultScale')(v as EducationRecord['resultScale'])} options={SCALES} />
        <TextField label="Result (GPA/CGPA)" inputMode="decimal" value={record.result} onChange={f('result')} error={validateResult(record.result, record.resultScale)} />
        <TextField label="Passing year" inputMode="numeric" maxLength={4} value={record.passingYear} onChange={f('passingYear')} error={validateYear(record.passingYear)} />
        {!school && (
          <TextField label="Course duration (years)" value={record.durationYears} onChange={f('durationYears')} suggestions={DURATIONS} error={validateDuration(record.durationYears)} />
        )}
      </div>
    </div>
  );
}

function JobCard({
  index, total, job, onChange, onRemove, onMove,
}: {
  index: number; total: number; job: JobRecord; onChange: (j: JobRecord) => void; onRemove: () => void; onMove: (dir: -1 | 1) => void;
}) {
  const f = <K extends keyof JobRecord>(k: K) => (v: JobRecord[K]) => onChange({ ...job, [k]: v });
  return (
    <div className="op-list-item" role="group" aria-label={`Job ${index + 1}`}>
      <div className="ff-card-head">
        <h4>Job {index + 1}</h4>
        <div className="ff-card-actions">
          <Button className="ff-btn-small" disabled={index === 0} onClick={() => onMove(-1)} aria-label={`Move job ${index + 1} up`}>Up</Button>
          <Button className="ff-btn-small" disabled={index === total - 1} onClick={() => onMove(1)} aria-label={`Move job ${index + 1} down`}>Down</Button>
          <Button className="ff-btn-small" tone="danger" onClick={onRemove} aria-label={`Remove job ${index + 1}`}>Remove</Button>
        </div>
      </div>
      <div className="ff-grid">
        <TextField label="Employment type" value={job.employmentType} onChange={f('employmentType')} suggestions={EMPLOYMENT_TYPES} />
        <TextField label="Designation / Post" value={job.designation} onChange={f('designation')} />
        <TextField label="Organization" value={job.organization} onChange={f('organization')} />
        <TextField label="Office address" value={job.officeAddress} onChange={f('officeAddress')} />
        <TextField label="Start date" type="date" value={job.startDate} onChange={f('startDate')} />
        <TextField
          label="End date"
          type="date"
          value={job.currentlyWorking ? '' : job.endDate}
          disabled={job.currentlyWorking}
          onChange={f('endDate')}
          error={job.currentlyWorking ? '' : validateDateRange(job.startDate, job.endDate)}
        />
      </div>
      <div style={{ margin: '12px 0' }}>
        <Toggle label="I currently work here" checked={job.currentlyWorking} onChange={(v) => onChange({ ...job, currentlyWorking: v, endDate: v ? '' : job.endDate })} />
      </div>
      <TextArea label="Job description" rows={3} maxLength={300} value={job.description} onChange={f('description')} />
    </div>
  );
}

function ExtraEditor({ extra, onChange }: { extra: Record<string, string>; onChange: (e: Record<string, string>) => void }) {
  const entries = Object.entries(extra);
  return (
    <Card title="Extra fields" actions={<Button onClick={() => onChange({ ...extra, [uniqueKey(extra)]: '' })}>Add</Button>}>
      <p className="ff-muted" style={{ marginTop: 0 }}>Custom values (e.g. skype, nickname) that the matcher can use as <code>extra.&lt;key&gt;</code>.</p>
      {entries.map(([k, v], i) => (
        <div className="op-kv" key={i}>
          <TextField
            label="Key"
            value={k}
            onChange={(nk) => onChange(Object.fromEntries(entries.map(([ok, ov], j) => (j === i ? [nk, ov] : [ok, ov]))))}
          />
          <TextField label="Value" value={v} onChange={(nv) => onChange({ ...extra, [k]: nv })} />
          <Button tone="danger" aria-label={`Remove ${k}`} onClick={() => onChange(Object.fromEntries(entries.filter((_, j) => j !== i)))}>Remove</Button>
        </div>
      ))}
    </Card>
  );
}

function uniqueKey(extra: Record<string, string>): string {
  let n = 1;
  while (`field${n}` in extra) n++;
  return `field${n}`;
}
