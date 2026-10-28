# Teletalk job portal reference (observed live, BCIC circular, Oct 2026)

Sample: `http://bcic.teletalk.com.bd/bcic202606/application.php` (Assistant Programmer, post_code 140). Every Teletalk circular uses the same template under `<org>.teletalk.com.bd/<org><yyyymm>/`.

## Navigation flow

A direct GET of `application.php` returns the page shell plus "Access Denied!". The form is reached by POSTs through:
`index.php` → `circulars.php` (radio: circular, Next) → `posts.php` (radio `post_code`, `#submit`) → `premium.php` (radio `#nid_02` = not a premium member, `#submit`) → `application.php`.
Reloading `application.php` breaks (it was a POST); walk the flow again.

Teletalk has its own "AllJobs Premium" autofill (`utils/alljobs/autofill.js`); we do the same for non-members. That script is the best reference for what the page expects. Its key behaviours:
- Names are written **UPPERCASE** (`name`, `father`, `mother`). Bangla names as-is.
- `dob` set via `valueAsDate` (it is `<input type=date>` with min/max = allowed age window for the post).
- Selects are matched by **option text, trimmed, case-insensitive** (`selectValue`), then the select's inline `onchange` is invoked.
- Order: `nid` = 1 then `.change()` then `nid_no`; `marital_status` then onchange then `spouse_name`; `quota` then onchange; `present_district` then onchange (synchronously fills `present_upazila` from inline `upazilaThanaList`) then upazila; exam → onchange (fills group/subject list) → board → onchange → roll → result_type → onchange (reveals result input) → result → year → group → onchange.
- "Same as present": check `#same_as_present` and call its `onclick` (`onOffSameAsBtn(this)`).
- Optional sections are gated by checkboxes `#if_applicable_mas`, `#if_applicable_exp` (onclick handlers). Extra job rows: `#addNewJob` onclick.

All dependent data (`districtList`, `upazilaThanaList`, `subjectGroupSSC/HSC`, `subjectDegreeListGRA/MAS`) is inline in the page; dependents populate **synchronously** inside inline `onchange="…"` handlers. Native `change` events dispatched from a content script trigger inline attribute handlers, so no MAIN-world injection is needed; still wait briefly and verify the child options exist before filling.

Stack: PHP 5.4, Bootstrap 4.6, jQuery 3.6. One form `#applicationForm` (POST → `preview.php`), classes `form-inline was-validated custom-form`. Sections are `<fieldset><legend>`. Labels are real `<label>`s. No iframes, no shadow DOM.

## Fields (name = id unless noted)

Hidden, never touch: `post_code post_name ad_ref_no unique_id alljobs_id age_calculated total_job_exp* ssc_hsc_data_mismatch is_allowed_result *_result_eq CAPTCHA_ACTUAL ssc_reg ssc_verified hsc_reg hsc_verified job[n][job_length]`.

| name | type | profile key | notes |
|---|---|---|---|
| name | text(50) | personal.nameEn | uppercase |
| name_bn | text(50) | personal.nameBn | |
| father / father_bn | text(50) | personal.fatherEn / fatherBn | uppercase EN |
| mother / mother_bn | text(50) | personal.motherEn / motherBn | uppercase EN |
| dob | date | personal.dob | min/max age window |
| nationality | select | personal.nationality | `Bangladeshi` |
| religion | select | personal.religion | 1 Islam, 2 Hinduism, 3 Buddhism, 4 Christianity, 5 Other |
| gender | select | personal.gender | values = text: Male, Female, Third Gender |
| nid | select | ids.hasNid | 1 Yes / 0 No → reveals `nid_no` (number) |
| breg | select | ids.hasBirthReg | → reveals `breg_no` (number) |
| passport | select | ids.hasPassport | → reveals `passport_no` (text 15) |
| marital_status | select | personal.maritalStatus | Single/Married/Other; Married reveals `spouse_name` |
| mobile, confirm_mobile | tel(11) | contact.mobile, contact.mobileConfirm | |
| email | email(50) | contact.email | |
| quota | select | quota | 1 Child of Freedom Fighter … 8 Not Applicable; some reveal `quota_details` |
| dep_status | select | departmentalStatus | 1 Govt. Employee … 5 Not Applicable |
| present_careof | text | presentAddress.careOf | |
| present_village | textarea(150) | presentAddress.village | |
| present_district | select(64) | presentAddress.district | onchange fills present_upazila |
| present_upazila | select | presentAddress.upazila | dependsOn present_district |
| present_post | text | presentAddress.postOffice | |
| present_postcode | number(4) | presentAddress.postCode | |
| same_as_present | checkbox | permanentSameAsPresent | onclick copies present → permanent |
| permanent_* | same as present | permanentAddress.* | |
| ssc_exam | select | education.ssc.exam | S.S.C, Dakhil, S.S.C Vocational, O Level/Cambridge, S.S.C Equivalent, Dakhil Vocational; onchange fills ssc_group |
| ssc_roll | number | education.ssc.roll | |
| ssc_group | select | education.ssc.group | dependsOn ssc_exam; Science, Humanities, Business Studies, General, Other (99 → ssc_group_other) |
| ssc_board | select | education.ssc.board | Barishal, Chattogram, Cumilla, Dhaka, Dinajpur, Jashore, Madrasah, Mymensingh, Rajshahi, Sylhet, Open University, … , Other (99 → ssc_board_other) |
| ssc_result_type | select | education.ssc.resultScale | "GPA(out of 4)" = 4, "GPA(out of 5)" = 5 → reveals ssc_result |
| ssc_result | number 1.0–5.0 step .01 | education.ssc.result | dependsOn ssc_result_type |
| ssc_year | select | education.ssc.passingYear | |
| hsc_* | as SSC | education.hsc.* | exams: H.S.C, Alim, Business Management, Diploma-in-Engineering, A Level, … |
| gra_exam | select | education.graduation.exam | B.Sc Engineering, Honors, Graduation Equivalent; onchange fills gra_subject |
| gra_institute | select(245) | education.graduation.institute | Other → gra_institute_other |
| gra_subject | select | education.graduation.subject | dependsOn gra_exam |
| gra_result_type | select | education.graduation.resultScale | "CGPA(out of 4)" / "CGPA(out of 5)" |
| gra_result | number | education.graduation.result | |
| gra_year | select | education.graduation.passingYear | |
| gra_duration | select | education.graduation.durationYears | "03 Years", "04 Years", "05 Years" |
| if_applicable_mas | checkbox | education.masters.applicable | gates mas_* |
| mas_* | as graduation | education.masters.* | mas_duration options include "1.5 Years", "3+ Years" |
| if_applicable_exp | checkbox | experience.applicable | gates job rows |
| job[0][employment_type] (id employment_type) | select | experience.0.employmentType | |
| job[0][designation] | text | experience.0.designation | |
| job[0][job_start_date] / job[0][job_end_date] | date | experience.0.startDate / endDate | |
| job[0][currently_working] | checkbox | experience.0.currentlyWorking | |
| job[0][organization] | text | experience.0.organization | |
| job[0][office_address] | text | experience.0.officeAddress | |
| job[0][job_description] | textarea(300) | experience.0.description | |
| captcha | text | — | never fill |
| agree | checkbox | — | never fill (user declares) |
