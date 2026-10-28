import { emptyEducation, emptyJob } from '@/shared/profile';

/** Set a dotted path on a mutable object, creating containers (education/job records get full defaults) as needed. */
export function setPath(root: object, path: string, value: unknown): void {
  const parts = path.split('.');
  let cur = root as Record<string, unknown>;
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!;
    const next = parts[i + 1]!;
    let child = cur[p];
    if (child == null || typeof child !== 'object') {
      if (/^\d+$/.test(next)) child = [];
      else if (parts[i - 1] === 'education' || (i === 1 && parts[0] === 'education')) child = emptyEducation();
      else child = {};
      cur[p] = child;
    }
    if (Array.isArray(child) && p === 'experience' && /^\d+$/.test(next)) {
      while (child.length <= Number(next)) child.push(emptyJob());
    }
    cur = child as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]!] = value;
}
