/**
 * Test helpers: mount an HTML fixture into the Vitest jsdom document and run
 * its inline <script> (Vitest's jsdom runs with runScripts: 'dangerously', so
 * inline on* attributes work too). Scripts set through innerHTML never run,
 * so they are re-created as fresh elements.
 */
import type { Profile } from '@/shared/types';
import { emptyProfile } from '@/shared/profile';
import genericHtml from './generic-form.html?raw';
import teletalkHtml from './teletalk-bcic-application.html?raw';

export const TELETALK_URL = 'https://bcic.teletalk.com.bd/bcic202606/application.php';
export const GENERIC_URL = 'https://jobs.example.com/apply';

export function mountHtml(html: string): Document {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  document.head.innerHTML = parsed.head.innerHTML;
  document.body.innerHTML = parsed.body.innerHTML;
  for (const src of Array.from(parsed.body.querySelectorAll('script'))) {
    const s = document.createElement('script');
    s.textContent = src.textContent;
    document.body.appendChild(s);
  }
  return document;
}

export const mountTeletalk = (): Document => mountHtml(teletalkHtml);
export const mountGeneric = (): Document => mountHtml(genericHtml);

/** A complete applicant, written the way a person would type it (aliases, short forms). */
export function sampleProfile(): Profile {
  const p = emptyProfile();
  p.personal = {
    nameEn: 'Rahim Uddin',
    nameBn: 'রহিম উদ্দিন',
    fatherEn: 'Karim Uddin',
    fatherBn: 'করিম উদ্দিন',
    motherEn: 'Ayesha Begum',
    motherBn: 'আয়েশা বেগম',
    dob: '1998-04-21',
    gender: 'Male',
    religion: 'Muslim',
    nationality: 'Bangladeshi',
    maritalStatus: 'Unmarried',
    spouseName: '',
    bloodGroup: 'B+',
  };
  p.ids = { nid: '1234 567 890', birthReg: '', passport: '' };
  p.contact = { mobile: '+8801712345678', email: 'rahim@example.com' };
  p.quota = 'Not Applicable';
  p.departmentalStatus = 'Not Applicable';
  p.presentAddress = {
    careOf: 'Abdul Karim',
    village: 'House 12, Road 5, Bank Colony',
    district: 'Dhaka',
    upazila: 'Savar',
    postOffice: 'Savar',
    postCode: '1340',
  };
  p.permanentSameAsPresent = true;
  p.education = {
    ssc: {
      exam: 'SSC', board: 'Dhaka', institute: '', roll: '123456', registration: '9876', group: 'Science',
      subject: '', resultScale: '5', result: '5.00', passingYear: '2014', durationYears: '',
    },
    hsc: {
      exam: 'HSC', board: 'Dhaka', institute: '', roll: '654321', registration: '5432', group: 'Science',
      subject: '', resultScale: '5', result: '4.83', passingYear: '2016', durationYears: '',
    },
    graduation: {
      exam: 'B.Sc Engineering', board: '', institute: 'BUET', roll: '', registration: '', group: '',
      subject: 'CSE', resultScale: '4', result: '3.75', passingYear: '2021', durationYears: '4',
    },
  };
  p.experience = [
    {
      employmentType: 'Private Organization',
      designation: 'Software Engineer',
      organization: 'Acme Ltd',
      officeAddress: 'Gulshan, Dhaka',
      startDate: '2021-06-01',
      endDate: '',
      currentlyWorking: true,
      description: 'Built and maintained web applications.',
    },
  ];
  return p;
}
