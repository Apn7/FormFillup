/**
 * Equivalent spellings for select-option matching. Each group lists variants
 * of one value; comparison is done on compactKey() of every entry, so case,
 * spaces and punctuation do not matter here ("S.S.C" == "ssc").
 *
 * Add new groups freely: a value only ever matches inside its own group.
 */
import { compactKey } from './text';

export const ALIAS_GROUPS: readonly (readonly string[])[] = [
  // Districts / divisions / boards with old and new official spellings
  ['Chattogram', 'Chittagong', 'Ctg'],
  ['Cumilla', 'Comilla'],
  ['Barishal', 'Barisal'],
  ['Jashore', 'Jessore'],
  ['Bogura', 'Bogra'],
  ['Chapai Nawabganj', 'Chapainawabganj', 'Chapai Nababganj', 'Chapainababganj'],
  ['Jhalokathi', 'Jhalokati', 'Jhalakathi', 'Jhalakati'],
  ['Moulvibazar', 'Maulvibazar', 'Moulvi Bazar'],
  ['Netrokona', 'Netrakona'],
  ['Narsingdi', 'Narshingdi'],
  ['Brahmanbaria', 'B. Baria'],
  ['Lakshmipur', 'Laxmipur'],
  ['Panchagarh', 'Panchgarh'],
  ['Khagrachhari', 'Khagrachari', 'Khagrachori'],
  ['Cox’s Bazar', 'Coxs Bazar', 'Cox Bazar'],
  ['Kushtia', 'Kushtiya'],
  ['Mymensingh', 'Mymenshingh'],
  ['Madrasah', 'Madrasa', 'Madrassa', 'Madrasah Board'],
  ['Bangladesh Technical Education Board (BTEB)', 'Technical', 'BTEB', 'Technical Board'],

  // Religion
  ['Islam', 'Muslim', 'Islamic'],
  ['Hinduism', 'Hindu', 'Sanatan'],
  ['Buddhism', 'Buddhist', 'Bouddha'],
  ['Christianity', 'Christian'],

  // Marital status / gender / nationality
  ['Single', 'Unmarried', 'Never Married'],
  ['Married'],
  ['Divorced', 'Divorcee'],
  ['Widowed', 'Widow', 'Widower'],
  ['Male', 'M', 'Man'],
  ['Female', 'F', 'Woman'],
  ['Third Gender', 'Hijra', 'Transgender'],
  ['Bangladeshi', 'Bangladesh', 'BD'],

  // Generic answers
  ['Yes', 'Y', 'True', 'হ্যাঁ'],
  ['No', 'N', 'False', 'না'],
  ['Not Applicable', 'N/A', 'NA', 'None', 'Not Required'],

  // Exams and groups
  ['S.S.C', 'SSC', 'Secondary School Certificate', 'Matriculation', 'Matric'],
  ['H.S.C', 'HSC', 'Higher Secondary Certificate', 'Intermediate'],
  ['O Level/Cambridge', 'O Level', 'O-Level', 'GCE O Level'],
  ['A Level/Sr. Cambridge', 'A Level', 'A-Level', 'GCE A Level'],
  ['Diploma-in-Engineering', 'Diploma in Engineering', 'Diploma Engineering'],
  ['Science', 'Sci'],
  ['Humanities', 'Arts'],
  ['Business Studies', 'Commerce', 'Business', 'Business Study'],
  ['Honors', 'Honours', 'Hons', 'Bachelor (Honors)', 'Bachelor Honours', 'BA (Hons)', 'BSc (Hons)', 'BSS (Hons)', 'BBA'],
  ['B.Sc Engineering', 'BSc Engineering', 'B.Sc Engg', 'BSc in Engineering', 'B.Sc. Engineering', 'BSc Engg'],
  ['M.Sc', 'MSc', 'Master of Science'],
  ['M.A', 'MA', 'Master of Arts'],
  ['M.B.A', 'MBA', 'Master of Business Administration'],
  ['M.S.S', 'MSS', 'Master of Social Science'],
  ['M.Com', 'MCom', 'Master of Commerce'],

  // Subjects
  ['Computer Science & Engineering', 'CSE', 'Computer Science and Engineering'],
  ['Electrical & Electronic Engineering', 'EEE', 'Electrical and Electronic Engineering', 'Electrical & Electronics Engineering'],
  ['Information and Communication Technology', 'ICT'],

  // Universities (short names people actually type)
  ['University of Dhaka', 'Dhaka University', 'DU'],
  ['University of Chittagong', 'Chittagong University', 'CU', 'University of Chattogram', 'Chattogram University'],
  ['University of Rajshahi', 'Rajshahi University', 'RU'],
  ['Jahangirnagar University', 'JU'],
  ['National University', 'NU'],
  ['Bangladesh University of Engineering & Technology', 'BUET'],
  ['Chittagong University of Engineering & Technology', 'CUET', 'Chattogram University of Engineering & Technology'],
  ['Khulna University of Engineering and Technology', 'KUET'],
  ['Rajshahi University of Engineering & Technology', 'RUET'],
  ['Shahjalal University of Science & Technology', 'SUST'],
];

/** Fold common transliteration drift ("-gonj" vs "-ganj") before alias lookup. */
function foldSpelling(key: string): string {
  return key.replace(/gonj/g, 'ganj');
}

const canonicalByKey: Map<string, number> = (() => {
  const m = new Map<string, number>();
  ALIAS_GROUPS.forEach((group, i) => {
    for (const v of group) m.set(foldSpelling(compactKey(v)), i);
  });
  return m;
})();

/** Alias group index of a value, or undefined. */
export function aliasGroupOf(value: string): number | undefined {
  return canonicalByKey.get(foldSpelling(compactKey(value)));
}

/** True when both values are listed in the same alias group (or fold to the same spelling). */
export function areAliases(a: string, b: string): boolean {
  const ka = foldSpelling(compactKey(a));
  const kb = foldSpelling(compactKey(b));
  if (ka && ka === kb) return true;
  const ga = canonicalByKey.get(ka);
  return ga !== undefined && ga === canonicalByKey.get(kb);
}
