// Checking Pathway's facts files against the project's rules, exactly as validate_facts.py does.
// Usage: node tools/validate-facts.js            checks www/data in this project
//        node tools/validate-facts.js --flat DIR checks facts-<code>.json files in DIR, as the Python version does
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FORMAT = 1;
const KINDS = new Set(["date", "window", "duration", "money", "number", "text", "months", "testDates"]);
const STATUSES = new Set(["confirmed", "reported", "expected"]);
const KEYED_BY = new Set(["cycle", "hscYear", "series", "testDate", "observedOn", "academicYear"]);
const UNITS = new Set(["days", "workingDays", "businessDays", "weeks", "months", "years"]);
const ENTRY_FIELDS = ["value", "status", "source", "where", "checked", "verified", "note"];
const DATE_FIELDS = ["date", "from", "to", "test", "register", "lateRegister", "scoresStudents", "scoresColleges"];
const TIME_RE = /^(?:[01][0-9]|2[0-3]):[0-5][0-9]$/;
const KEY_RE = {
  cycle: /^[0-9]{4}$/,
  hscYear: /^[0-9]{4}$/,
  series: /^[0-9]{4}-[0-9]{2}$/,
  testDate: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  observedOn: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
  academicYear: /^[0-9]{4}$/,
};
const TOP_FIELDS = ["format", "file", "title", "checked", "sources", "facts"];
const BANNED = [
  ["\u2014", "a long dash"],
  ["\u2013", "a short dash (data files write ranges with 'to')"],
  ["\u00b7", "a middle dot"],
  ["!", "an exclamation mark"],
];

// Allowing only the time zones the engine tests prove the app converts offline
const ZONES = new Set(["UTC", "Asia/Dhaka", "America/New_York", "Europe/Helsinki", "Europe/Istanbul", "Asia/Kuala_Lumpur", "Pacific/Auckland"]);

// Counting how many intake years ahead every cycle-keyed fact must reach, from the file's checked
// year. HSC years and A level series reach one year less, because school ends the year before studies begin
const HORIZON_YEARS = 6;

// Taking an academic year to begin in this month: a fee keyed by academic year must reach the year
// that began most recently by this month, and may run at most one year past the file's checked year
const ACADEMIC_YEAR_START_MONTH = 8;

// Classifying every source. "general" means its rule applies to everyone; any other value is the
// institution's name, which must then appear in the label of every fact using that source
const SOURCE_OWNER = {
  "bd/dip-portal": "general", "bd/unb-epassport": "general", "bd/tbs-nid16": "general",
  "bd/bc-bd-book": "British Council", "bd/bc-bd-results": "general", "bd/idp-bd": "IDP",
  "bd/ets-toefl-scores": "general", "bd/ets-toefl-scale": "general", "bd/ets-toefl-id": "general",
  "bd/det-official": "general",
  "bd/tcmb-rates": "general",
  "bd/bnm-reference": "general",
  "bd/rbnz-b1": "general",
  "bd/det-scoring-guide": "general", "bd/det-help-validity": "general",
  "bd/pte-results": "general", "bd/pte-id-policy": "general", "bd/pte-the-test": "general",
  "bd/edudaily-india": "general",
  "bd/tripzic-india": "general", "bd/bhc-london-pcc": "general", "bd/isg-pcc": "general",
  "bd/cb-sat-dates": "general", "bd/cb-sat-flyer-intl": "general", "bd/teachers-hsc2027": "general",
  "bd/prothomalo-hsc2026": "general", "bd/prothomalo-hsc2026-shift": "general",
  "bd/dhakatribune-hsc2026": "general", "bd/cie-nov2026": "general", "bd/cie-dates": "general",
  "bd/pearson-results": "general", "bd/tutopiya-ial-oct2026": "general",
  "bd/bb-fx": "general", "bd/cb-intl-fees": "general",
  "bd/prothomalo-imo-2025": "general", "bd/tds-bdpho-2025": "general", "bd/dt-bdbo-2026": "general",
  "bd/diu-bdoi-2024": "general", "bd/observer-ioi-2024": "general", "bd/fe-ijso-2025": "general",
  "bd/prothomalo-ieo-2025": "general", "bd/tbs-spaceapps-2024": "general",
  "bd/du-bdcho-2026": "Bangladesh Chemistry Olympiad", "bd/cassa-bdoaa-2026": "Bangladesh Olympiad on Astronomy and Astrophysics",
  "bd/bdosn-ioai-2026": "Bangladesh AI Olympiad",
  "bd/bdmo-about": "Bangladesh Mathematical Olympiad", "bd/mit-look-for": "MIT",
  "bd/ets-toefl-fees": "general", "bd/pte-fees": "general", "bd/det-test-takers": "general",
  "bd/bb-fepd29": "general", "bd/dailystar-cards": "general", "bd/bankasia-studentfile": "Bank Asia",
  "bd/nuffic-bd": "general", "bd/ets-scale-update": "general", "bd/pte-concordance": "general", "bd/pte-scoring": "general", "bd/ielts-cefr": "general",
  "bd/ielts-scoring": "general", "bd/pte-score-guide": "general",
  "us/sits-visa-guidance": "general", "us/dos-student-visa": "general", "us/dos-wait-times": "general",
  "us/middlebury-sevis": "general", "us/bu-isso-vif": "general",
  "us/uw-iss-vetting": "general", "us/visagrader-dhaka": "general",
  "us/harvard-apply": "Harvard", "us/harvard-firstyear": "Harvard", "us/cornell-intl-aid": "Cornell",
  "us/stanford-intl": "Stanford", "us/columbia-aid": "Columbia", "us/penn-intl-aid": "Penn", "us/cornell-intl-finaid": "Cornell",
  "us/northwestern-intl-aid": "Northwestern", "us/pomona-intl": "Pomona", "us/wellesley-intl-aid": "Wellesley",
  "us/uw-i20": "University of Washington", "us/jmu-i20": "James Madison University",
  "us/qs-2027": "general", "us/edusa-undergrad": "general", "us/edusa-bd": "general",
  "us/commonapp-intl": "general", "us/commonapp-activities": "general", "us/commonapp-gather": "general",
  "us/css-cost": "general", "us/css-waivers": "general", "us/dos-reciprocity-bd": "general",
  "us/dos-suspension": "general", "us/dos-visa-bonds": "general", "us/yale-oiss-ds": "general",
  "us/ice-employment": "general", "us/ice-sevis": "general", "us/uf-stem-opt": "general",
  "us/maven-vif": "general", "us/harvard-intl": "Harvard", "us/harvard-aid": "Harvard",
  "us/harvard-stats": "Harvard", "us/harvard-advising": "Harvard", "us/harvard-essays": "Harvard",
  "us/mit-sfs": "MIT", "us/mit-tests": "MIT", "us/yale-intl": "Yale",
  "us/princeton-intl": "Princeton", "us/dartmouth-aid": "Dartmouth", "us/dartmouth-tests": "Dartmouth",
  "us/brown-aid": "Brown", "us/brown-tests": "Brown", "us/brown-ed": "Brown",
  "us/amherst-intl": "Amherst", "us/bowdoin-intl": "Bowdoin", "us/bowdoin-tests": "Bowdoin",
  "us/williams-aid": "Williams", "us/swarthmore-intl": "Swarthmore", "us/swarthmore-tests": "Swarthmore",
  "us/usembassy-fraud": "general",
  "us/css-about": "general", "us/fr-opt-fees": "general", "us/dos-niv-residence": "general",
  "us/bd-embassy-visas": "general", "us/mit-deadlines": "MIT", "us/williams-apply": "Williams",
  "us/princeton-paw": "Princeton", "us/brown-english": "Brown", "us/brown-intl-aid": "Brown",
  "us/dartmouth-faq": "Dartmouth", "us/koppelman-essay": "general",
  "us/mit-fee": "MIT", "us/brown-checklist": "Brown", "us/dartmouth-fee": "Dartmouth",
  "us/amherst-firstyear": "Amherst", "us/bowdoin-apply": "Bowdoin", "us/williams-firstyear": "Williams",
  "us/swarthmore-materials": "Swarthmore", "us/yale-requirements": "Yale", "us/princeton-checklist": "Princeton",
  "us/commonapp-grid": "general",
  "us/txst-bangladesh": "Texas State", "us/wku-bangladesh": "Western Kentucky", "us/commonapp-counselor-intl": "general", "us/dos-interview-waiver": "general", "us/dos-visa-denials": "general", "us/usembassy-visiting": "general", "us/usembassy-expect": "general",
  "fi/sif-joint": "general", "fi/oph-2025": "general", "fi/oph-2026": "general",
  "fi/helsinki-apply": "University of Helsinki", "fi/jyu-apply": "Jyväskylä", "fi/jyu-sat": "Jyväskylä",
  "fi/uasinfo-exam": "general", "fi/savonia-exam": "general",
  "fi/fi-abroad-bgd": "general", "fi/uh-permit": "general",
  "fi/helsinki-calendar": "University of Helsinki",
  "fi/sif-joint-jan2026": "general", "fi/dvv-pic": "general", "fi/yle-family": "general",
  "fi/laurea-certs": "Laurea",
  "fi/uh-english": "University of Helsinki", "fi/tuni-language": "Tampere University", "fi/jyu-english": "Jyväskylä",
  "fi/oulu-english": "University of Oulu", "fi/uef-english": "University of Eastern Finland",
  "fi/uh-apply": "University of Helsinki", "fi/uh-las": "University of Helsinki", "fi/uh-fees": "University of Helsinki",
  "fi/uh-stats": "University of Helsinki", "fi/uh-cost": "University of Helsinki",
  "fi/aalto-hsd": "Aalto", "fi/aalto-fees": "Aalto", "fi/aalto-admission": "Aalto",
  "fi/utu-ict": "University of Turku", "fi/utu-fees": "University of Turku", "fi/utu-language": "University of Turku",
  "fi/tuni-programmes": "Tampere University", "fi/tuni-applying": "Tampere University", "fi/tuni-eligibility": "Tampere University",
  "fi/tuni-stats": "Tampere University", "fi/tuni-fees": "Tampere University",
  "fi/oulu-apply": "University of Oulu", "fi/oulu-sat": "University of Oulu", "fi/oulu-fees": "University of Oulu",
  "fi/jyu-programmes": "Jyväskylä", "fi/jyu-fees": "Jyväskylä",
  "fi/lut-programmes": "LUT", "fi/lut-criteria": "LUT", "fi/lut-alevel": "LUT",
  "fi/lut-scholarships": "LUT",
  "fi/abo-guide": "Åbo Akademi",
  "fi/uef-intl": "University of Eastern Finland", "fi/uef-socsci": "University of Eastern Finland", "fi/uef-data": "University of Eastern Finland",
  "fi/uef-fees": "University of Eastern Finland",
  "fi/metropolia-fees": "Metropolia",
  "fi/haagahelia-fees": "Haaga-Helia",
  "fi/tamk-fees": "Tampere University of Applied Sciences",
  "fi/turkuamk-fees": "Turku University of Applied Sciences",
  "fi/qs-2027": "general", "fi/uniarts-fees": "general", "fi/jyu-faq": "general",
  "fi/uasinfo-studying": "general", "fi/uasinfo-language": "general", "fi/uasinfo-sections": "general",
  "fi/okm-degrees": "general", "fi/sif-faq": "general", "fi/sif-scholarships": "general",
  "fi/sif-fake": "general", "fi/jamk-eligibility": "general",
  "fi/oph-2026-admitted": "general", "fi/savonia-oneplace": "general", "fi/migri-fees": "general",
  "fi/migri-income": "general", "fi/migri-permit-app": "general", "fi/migri-insurance": "general",
  "fi/migri-processing": "general", "fi/migri-2022": "general", "fi/migri-work": "general",
  "fi/migri-jobseek": "general", "fi/migri-safe": "general", "fi/migri-future": "general",
  "fi/fi-abroad-ind-jobs": "general", "fi/fi-abroad-verify": "general", "fi/yle-agents": "general",
  "fi/vfs-delhi": "general", "fi/dvv-events": "general", "fi/kela-fee": "general",
  "fi/kela-students": "general", "fi/kela-socialassist": "general", "fi/gov-2025-12": "general",
  "tr/metu-dates": "METU", "tr/metu-closed": "METU", "tr/metu-faq": "METU",
  "tr/metu-calendar": "METU",
  "tr/eurydice-tr": "general",
  "tr/osym-tryos1-guide": "general", "tr/mosaic-howto": "general", "tr/mosaic-fees": "general",
  "tr/sabanci-scholarships": "Sabancı",
  "tr/yok-principles": "general", "tr/metu-about": "METU", "tr/boun-about": "Boğaziçi",
  "tr/bilkent-catalog": "Bilkent", "tr/koc-elc": "Koç", "tr/sabanci-languages": "Sabancı",
  "tr/metu-ielts": "METU", "tr/itu-residence": "Istanbul Technical University",
  "tr/uskudar-denklik": "general",
  "tr/metu-reqs-pdf": "METU", "tr/metu-fees": "METU", "tr/metu-english": "METU",
  "tr/metu-cost": "METU",
  "tr/boun-reqs": "Boğaziçi", "tr/boun-fees": "Boğaziçi", "tr/boun-english": "Boğaziçi",
  "tr/bilkent-apply": "Bilkent", "tr/bilkent-minimums": "Bilkent", "tr/bilkent-fees": "Bilkent",
  "tr/bilkent-aid": "Bilkent", "tr/bilkent-english": "Bilkent",
  "tr/koc-fees": "Koç", "tr/koc-apply": "Koç",
  "tr/sabanci-apply": "Sabancı", "tr/sabanci-exams": "Sabancı", "tr/sabanci-fees": "Sabancı",
  "tr/sabanci-aid": "Sabancı",
  "tr/itu-round2": "Istanbul Technical University", "tr/itu-exams": "Istanbul Technical University", "tr/itu-fees": "Istanbul Technical University",
  "tr/itu-english": "Istanbul Technical University",
  "tr/qs-2027": "general", "tr/yok-qs": "general", "tr/tb-programs": "general",
  "tr/tb-eligibility": "general", "tr/tb-calendar": "general", "tr/tb-steps": "general",
  "tr/tb-selection": "general", "tr/tb-howto": "general", "tr/tb-archive": "general",
  "tr/metu-residence": "general", "tr/metu-gss": "general", "tr/metu-work": "general",
  "tr/osym-tryos": "general", "tr/tr-emb-mosaic": "general", "tr/tr-emb-education": "general",
  "tr/mosaic-home": "general", "tr/mosaic-docs": "general", "tr/mfa-visa": "general",
  "tr/omu-denklik": "general", "tr/eikamet-docs": "general", "tr/ankara-gss": "general",
  "my/emgs-process": "general", "my/umpsa-val": "general", "my/sunway-mufy": "Sunway College",
  "my/um-faq-ug": "Universiti Malaya", "my/emgs-steps": "general",
  "my/monash-diploma": "Monash",
  "my/um-howto": "Universiti Malaya", "my/um-requirements": "Universiti Malaya", "my/um-faq-admission": "Universiti Malaya",
  "my/um-fees": "Universiti Malaya", "my/um-life": "Universiti Malaya",
  "my/utm-entry": "Universiti Teknologi Malaysia", "my/utm-apply": "Universiti Teknologi Malaysia", "my/utm-faq": "Universiti Teknologi Malaysia",
  "my/utm-english": "Universiti Teknologi Malaysia", "my/utm-fees": "Universiti Teknologi Malaysia",
  "my/ukm-join": "Universiti Kebangsaan Malaysia",
  "my/usm-fees": "Universiti Sains Malaysia",
  "my/monash-entry": "Monash", "my/monash-intakes-apply": "Monash", "my/monash-fees": "Monash",
  "my/monash-english": "Monash",
  "my/mufy-brochure": "Sunway College",
  "my/sunway-apply": "Sunway University", "my/sunway-bursary": "Sunway University",
  "my/taylors-admission": "Taylor's", "my/taylors-cs-fees": "Taylor's", "my/taylors-aid": "Taylor's",
  "my/qs-2027": "general", "my/um-qsnews": "general", "my/monash-qsnews": "general",
  "my/imi-student-pass": "general", "my/emgs-faq": "general", "my/emgs-docs": "general",
  "my/emgs-medical": "general", "my/emgs-fees": "general", "my/emgs-bond": "general",
  "my/emgs-guidelines": "general", "my/emgs-insurance": "general", "my/emgs-graduate": "general",
  "my/emgs-sev": "general", "my/kln-dhaka-req": "general", "my/mohe-mis": "general",
  "my/monash-sst": "general", "my/iium-finance": "general", "my/malaymail-stats": "general",
  "my/prothomalo-agents": "general",
  "nz/uoa-calendar": "Auckland", "nz/uoa-closing": "Auckland", "nz/uoa-foundation": "Auckland",
  "nz/uoaic-entry": "Auckland", "nz/uoa-overseas-jz": "Auckland", "nz/uoa-overseas-ai": "Auckland",
  "nz/uoa-fees": "Auckland", "nz/uoa-english": "Auckland", "nz/uoa-cfs": "Auckland", "nz/uoa-deans-asia": "Auckland",
  "nz/uoa-deans-asia-regs": "Auckland", "nz/up-fees-2026": "UP Education",
  "nz/up-overview-2026": "University of Auckland International College",
  "nz/otago-entry": "Otago", "nz/otago-dates": "Otago", "nz/otago-fees-sci": "Otago", "nz/otago-english": "Otago",
  "nz/otago-scholarships": "Otago", "nz/otago-foundation-entry": "Otago", "nz/otago-foundation-fees": "Otago",
  "nz/otago-howto": "Otago",
  "nz/massey-visa": "Massey University", "nz/massey-entry": "Massey University", "nz/massey-dates": "Massey University",
  "nz/massey-fees": "Massey University", "nz/massey-grant": "Massey University",
  "nz/vuw-entry": "Victoria University of Wellington", "nz/vuw-dates": "Victoria University of Wellington",
  "nz/vuw-fees": "Victoria University of Wellington", "nz/vuw-english": "Victoria University of Wellington",
  "nz/vuw-scholarship": "Victoria University of Wellington",
  "nz/upnz-vuw-entry": "UP Education", "nz/upnz-aut-entry": "UP Education",
  "nz/uc-dates": "University of Canterbury", "nz/uc-prospectus": "University of Canterbury", "nz/uc-english": "University of Canterbury",
  "nz/ucic-entry": "UC International College", "nz/ucic-foundation": "UC International College",
  "nz/waikato-entry": "University of Waikato", "nz/waikato-apply": "University of Waikato", "nz/waikato-calendar": "University of Waikato",
  "nz/waikato-fees": "University of Waikato", "nz/waikato-english": "University of Waikato", "nz/waikato-vc": "University of Waikato",
  "nz/lincoln-entry": "Lincoln University", "nz/lincoln-dates": "Lincoln University",
  "nz/aut-entry": "Auckland University of Technology", "nz/aut-dates": "Auckland University of Technology",
  "nz/aut-fees": "Auckland University of Technology", "nz/aut-english": "Auckland University of Technology",
  "nz/aut-scholarship": "Auckland University of Technology",
  "nz/qs-2027": "general", "nz/tec-levels": "general", "nz/inz-fpsv": "general", "nz/inz-funds": "general",
  "nz/inz-fees-table": "general", "nz/inz-lowtb": "general", "nz/inz-waittimes": "general", "nz/inz-work-news": "general",
  "nz/inz-pswv": "general", "nz/inz-pswv-change": "general", "nz/inz-vac-fee": "general", "nz/inz-scams": "general",
  "nz/iaa-agents": "general", "nz/enz-update": "general", "nz/swnz-cost": "general", "nz/manaaki-countries": "general",
  "nz/figurenz-bd": "general", "nz/inz-xray": "general",
  "nz/uoa-appfee": "University of Auckland",
  "nz/otago-cambridge": "Otago", "nz/vuw-cambridge": "Victoria University of Wellington", "nz/inz-oia-interviews": "general",
};

// Naming the owner of facts that differ from their source's classification. Taylor's states the
// national EMGS processing time, so that fact is general
const FACT_OWNER = {
  "us/app.commonApp.opens": "general",
  "my/pass.processing": "general",
  "bd/ielts.bd.remark": "British Council",
  "us/uni.mit.qsRank": "MIT",
  "us/uni.harvard.qsRank": "Harvard",
  "us/uni.yale.qsRank": "Yale",
  "us/uni.princeton.qsRank": "Princeton",
  "us/uni.brown.qsRank": "Brown",
  "us/uni.dartmouth.qsRank": "Dartmouth",
  "fi/uni.helsinki.qsRank": "University of Helsinki",
  "fi/uni.aalto.qsRank": "Aalto",
  "fi/uni.oulu.qsRank": "University of Oulu",
  "fi/uni.lut.qsRank": "LUT",
  "fi/uni.turku.qsRank": "University of Turku",
  "fi/uni.tampere.qsRank": "Tampere University",
  "fi/uni.jyvaskyla.qsRank": "Jyväskylä",
  "fi/uni.uef.qsRank": "University of Eastern Finland",
  "fi/uni.abo.qsRank": "Åbo Akademi",
  "tr/uni.itu.qsRank": "Istanbul Technical University",
  "tr/uni.metu.qsRank": "METU",
  "tr/uni.koc.qsRank": "Koç",
  "tr/uni.bogazici.qsRank": "Boğaziçi",
  "tr/uni.sabanci.qsRank": "Sabancı",
  "tr/uni.bilkent.qsRank": "Bilkent",
  "tr/uni.hacettepe.qsRank": "Hacettepe",
  "tr/uni.istanbul.qsRank": "Istanbul University",
  "tr/uni.yildiz.qsRank": "Yıldız Technical University",
  "my/uni.um.qsRank": "Universiti Malaya",
  "my/uni.usm.qsRank": "Universiti Sains Malaysia",
  "my/uni.ukm.qsRank": "Universiti Kebangsaan Malaysia",
  "my/uni.upm.qsRank": "Universiti Putra Malaysia",
  "my/uni.utm.qsRank": "Universiti Teknologi Malaysia",
  "my/uni.utp.qsRank": "Universiti Teknologi PETRONAS",
  "my/uni.taylors.qsRank": "Taylor's",
  "my/uni.ucsi.qsRank": "UCSI",
  "my/uni.sunway.qsRank": "Sunway",
  "my/uni.inti.qsRank": "INTI",
  "nz/uni.auckland.qsRank": "University of Auckland",
  "nz/uni.otago.qsRank": "University of Otago",
  "nz/uni.massey.qsRank": "Massey University",
  "nz/uni.victoria.qsRank": "Victoria University of Wellington",
  "nz/uni.canterbury.qsRank": "University of Canterbury",
  "nz/uni.waikato.qsRank": "University of Waikato",
  "nz/uni.lincoln.qsRank": "Lincoln University",
  "nz/uni.aut.qsRank": "Auckland University of Technology",
};

// Keeping these sources only so a note or a manual check can point to them
const REFERENCE_ONLY = {
  "bd/dip-portal": "the official passport portal, checked by hand before each release",
  "bd/prothomalo-hsc2026-shift": "the 2026 date change named in the HSC 2027 note",
  "us/sits-visa-guidance": "Study in the States, named in two visa notes",
  "us/bu-isso-vif": "Boston University, named in the Visa Integrity Fee note",
  "tr/metu-ielts": "METU's English page for international applicants, named in the METU English note",
  "tr/itu-residence": "Istanbul Technical University's residence permit page, named in two arrival notes",
  "tr/sabanci-scholarships": "Sabancı's scholarships page, named in the Sabancı aid note",
  "tr/ankara-gss": "Ankara University's health insurance notice, named in the health insurance note",
  "my/emgs-guidelines": "EMGS's guidelines page, named in the pass renewal note",
  "my/emgs-sev": "EMGS's list of countries needing a single-entry visa, which includes Bangladesh",
  "my/kln-dhaka-req": "the High Commission's visa page, named in the single-entry visa note",
  "my/iium-finance": "IIUM's service tax notice, named in the service tax note",
  "my/umpsa-val": "Universiti Malaysia Pahang's visa process annex, named in the processing note",
  "my/um-faq-admission": "Universiti Malaya's admission FAQ, named in the foundation and fee notes",
  "tr/uskudar-denklik": "Üsküdar University's equivalency page, named in the equivalency note",
  "tr/bilkent-minimums": "Bilkent's minimum scores sheet, named in the Bilkent admission note",
  "nz/inz-fees-table": "Immigration New Zealand's fee table, named in the visa fee note",
  "nz/inz-vac-fee": "Immigration New Zealand's notice on Visa Application Centre fees, named in the visa fee note",
  "nz/inz-work-news": "Immigration New Zealand's news on the 25-hour limit, named in the work note",
  "nz/enz-update": "Immigration New Zealand's July 2026 update, named in the police certificate note",
  "nz/upnz-aut-entry": "AUT's foundation entry table, named in the UP Education foundation note",
  "nz/waikato-calendar": "Waikato's teaching periods page, named in the Waikato dates note",
  "nz/otago-foundation-entry": "Otago's foundation entry document, named in the Otago foundation note",
  "nz/uoa-deans-asia": "Auckland's Dean's Asia Scholarship page, named in the scholarship note for the current round",
  "nz/inz-xray": "Immigration New Zealand's page on who needs an X-ray, named in the health note",
};

class BadDate extends Error { }

// Writing values the way Python prints them, so both validators report identical lines
function py(value) {
  if (value === null || value === undefined) {
    return "None";
  }
  if (value === true || value === false) {
    return value ? "True" : "False";
  }
  if (Array.isArray(value)) {
    return `[${value.map(pyItem).join(", ")}]`;
  }
  if (isObject(value)) {
    return `{${Object.entries(value).map(([key, item]) => `${pyItem(key)}: ${pyItem(item)}`).join(", ")}}`;
  }
  return String(value);
}

// Quoting text inside lists and objects, as Python does
function pyItem(value) {
  return typeof value === "string" ? `'${value}'` : py(value);
}

// Treating empty lists, empty objects, zero and empty text as false, as Python does
function truthy(value) {
  if (Array.isArray(value)) {
    return value.length > 0;
  }
  if (isObject(value)) {
    return Object.keys(value).length > 0;
  }
  return Boolean(value);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function has(object, key) {
  return isObject(object) && Object.hasOwn(object, key);
}

function get(object, key) {
  return has(object, key) ? object[key] : null;
}

function isNumber(value) {
  return typeof value === "number";
}

function isIn(value, options) {
  return typeof value === "string" && options.has(value);
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  return [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// Reading "YYYY-MM-DD" or "YYYY-MM" as an orderable number, never through Date
function parseDate(text) {
  if (typeof text === "string") {
    const match = /^([0-9]{4})-([0-9]{2})(?:-([0-9]{2}))?$/.exec(text);
    if (match) {
      const year = Number(match[1]);
      const month = Number(match[2]);
      const day = match[3] === undefined ? 1 : Number(match[3]);
      if (year >= 1 && month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month)) {
        return { year, month, day, order: year * 10000 + month * 100 + day, precision: match[3] === undefined ? "month" : "day" };
      }
    }
  }
  throw new BadDate(py(text));
}

function* stringsIn(node, path = "") {
  if (isObject(node)) {
    for (const [key, value] of Object.entries(node)) {
      if (key !== "url") {
        yield* stringsIn(value, `${path}.${key}`);
      }
    }
  } else if (Array.isArray(node)) {
    for (const [index, value] of node.entries()) {
      yield* stringsIn(value, `${path}[${index}]`);
    }
  } else if (typeof node === "string") {
    yield [path, node];
  }
}

function checkValue(kind, value, where, problems) {
  const variants = get(value, "variants");
  if (variants !== null && (!Array.isArray(variants) || variants.length === 0 || !variants.every(isObject))) {
    problems.push(`${where}: variants must be a list of objects`);
    return;
  }
  const items = truthy(variants) ? variants : [value];
  if (kind === "duration") {
    if (!isIn(get(value, "unit"), UNITS)) {
      problems.push(`${where}: duration needs a known unit`);
    }
    for (const item of items) {
      if (!isNumber(get(item, "max")) || (has(item, "min") && !isNumber(item.min))) {
        problems.push(`${where}: duration needs a max, and min and max must be numbers`);
      } else if (has(item, "min") && item.min > item.max) {
        problems.push(`${where}: min is larger than max`);
      }
    }
  } else if (kind === "money") {
    if (!truthy(get(value, "currency"))) {
      problems.push(`${where}: amount needs a currency`);
    }
    for (const item of items) {
      if (!isNumber(get(item, "amount"))) {
        problems.push(`${where}: amount must be a number`);
      }
    }
  } else if (kind === "number" && !isNumber(get(value, "number"))) {
    problems.push(`${where}: number must be a number`);
  } else if (kind === "text" && !truthy(get(value, "text"))) {
    problems.push(`${where}: text is empty`);
  } else if (kind === "months") {
    const months = Array.isArray(get(value, "months")) ? value.months : [];
    const bad = months.some((month) => !isNumber(month) || !Number.isInteger(month) || month < 1 || month > 12);
    if (months.length === 0 || bad || new Set(months).size !== months.length) {
      problems.push(`${where}: months must be distinct numbers from 1 to 12`);
    }
  } else if (kind === "window") {
    if (!truthy(get(value, "from")) || !truthy(get(value, "to"))) {
      problems.push(`${where}: window needs from and to`);
    } else if (parseDate(value.from).order > parseDate(value.to).order) {
      problems.push(`${where}: window ends before it starts`);
    }
  } else if (kind === "date" && !truthy(get(value, "date"))) {
    problems.push(`${where}: date needs a date`);
  } else if (kind === "testDates" && !truthy(get(value, "test"))) {
    problems.push(`${where}: test dates need a test day`);
  }
  if ((kind === "date" || kind === "testDates") && (truthy(get(value, "time")) || truthy(get(value, "zone")))) {
    if (typeof value.time !== "string" || !TIME_RE.test(value.time)) {
      problems.push(`${where}: time must be HH:MM, and a zone needs a time`);
    }
    if (!isIn(get(value, "zone"), ZONES)) {
      problems.push(`${where}: zone must be one of ZONES, and a time needs a zone`);
    }
  }
}

function checkFile(file, problems, counts) {
  const { code, name } = file;
  let raw = file.bytes;
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    problems.push(`${name}: starts with a byte order mark`);
    raw = raw.subarray(3);
  }
  let text;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    problems.push(`${name}: is not valid UTF-8`);
    return;
  }
  if (text.includes("\r")) {
    problems.push(`${name}: has Windows line endings`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    problems.push(`${name}: is not valid JSON`);
    return;
  }
  const missingTop = TOP_FIELDS.filter((field) => !has(data, field));
  if (missingTop.length > 0) {
    problems.push(`${name}: missing ${missingTop.join(", ")}`);
    return;
  }
  for (const [where, value] of stringsIn(data)) {
    for (const [char, label] of BANNED) {
      if (value.includes(char)) {
        problems.push(`${name}${where}: contains ${label}`);
      }
    }
  }
  if (data.format !== FORMAT) {
    problems.push(`${name}: format must be ${FORMAT}`);
  }
  if (data.file !== (code === "bd" ? "common/bd" : `countries/${code}`)) {
    problems.push(`${name}: file field does not match the file name`);
  }

  let checkedFile;
  try {
    checkedFile = parseDate(data.checked);
  } catch (error) {
    if (!(error instanceof BadDate)) {
      throw error;
    }
    problems.push(`${name}: bad date ${error.message}`);
    return;
  }
  const horizon = checkedFile.year + HORIZON_YEARS;
  const cutoffDay = checkedFile.month === 2 ? Math.min(checkedFile.day, 28) : checkedFile.day;
  const precisionCutoff = (checkedFile.year + 1) * 10000 + checkedFile.month * 100 + cutoffDay;

  const sources = data.sources;
  if (!isObject(sources) || !Array.isArray(data.facts)) {
    problems.push(`${name}: sources must be an object and facts a list`);
    return;
  }
  for (const [sid, src] of Object.entries(sources)) {
    if (!Object.hasOwn(SOURCE_OWNER, `${code}/${sid}`)) {
      problems.push(`${code}/${sid}: source is not classified in SOURCE_OWNER`);
    }
    for (const field of ["title", "publisher", "url", "official"]) {
      if (!has(src, field)) {
        problems.push(`${code}/${sid}: source is missing ${field}`);
      }
    }
    if (has(src, "url") && !(typeof src.url === "string" && src.url.startsWith("https://"))) {
      problems.push(`${code}/${sid}: source url must be an https address`);
    }
  }

  const used = new Set();
  // Collecting every value's checked date, for the file's own checked date to be held against
  const valueChecked = [];
  const facts = [];
  data.facts.forEach((fact, index) => {
    if (isObject(fact) && typeof fact.id === "string" && fact.id) {
      facts.push(fact);
    } else {
      problems.push(`${name}: fact number ${index + 1} has no id`);
    }
  });
  const ids = facts.map((fact) => fact.id);
  const duplicateIds = [...new Set(ids.filter((id, index) => ids.indexOf(id) !== index))].sort();
  for (const duplicate of duplicateIds) {
    problems.push(`${code}/${duplicate}: id used twice`);
  }

  for (const fact of facts) {
    const fid = `${code}/${fact.id}`;
    const kind = get(fact, "kind");
    counts.facts += 1;
    if (!isIn(kind, KINDS)) {
      problems.push(`${fid}: unknown kind ${py(kind)}`);
      continue;
    }
    if (!truthy(get(fact, "label"))) {
      problems.push(`${fid}: label is empty`);
    }
    if (has(fact, "value") === has(fact, "values")) {
      problems.push(`${fid}: needs exactly one of value or values`);
      continue;
    }
    const keyedBy = get(fact, "keyedBy");
    if (has(fact, "values")) {
      if (!Array.isArray(fact.values) || fact.values.length === 0 || !fact.values.every(isObject)) {
        problems.push(`${fid}: values must be a list of entries`);
        continue;
      }
      if (!isIn(keyedBy, KEYED_BY)) {
        problems.push(`${fid}: unknown keyedBy ${py(keyedBy)}`);
      }
      const keys = fact.values.map((entry) => get(entry, "key"));
      const duplicateKeys = [...new Set(keys.filter((key, index) => keys.indexOf(key) !== index).map(py))].sort();
      for (const duplicate of duplicateKeys) {
        problems.push(`${fid}: key ${duplicate} used twice`);
      }
      const pattern = KEY_RE[keyedBy];
      for (const key of keys) {
        if (pattern && !(typeof key === "string" && pattern.test(key))) {
          problems.push(`${fid}: key ${py(key)} does not fit keyedBy ${py(keyedBy)}`);
        }
      }
    }

    const entries = truthy(get(fact, "values")) ? fact.values : [fact];
    for (const entry of entries) {
      const ewhere = fid + (has(entry, "key") ? ` [${py(entry.key)}]` : "");
      counts.values += 1;
      const missing = ENTRY_FIELDS.filter((field) => !has(entry, field));
      if (missing.length > 0) {
        problems.push(`${ewhere}: missing ${missing.join(", ")}`);
        continue;
      }
      const { status, source: sid } = entry;
      if (!isIn(status, STATUSES)) {
        problems.push(`${ewhere}: unknown status ${py(status)}`);
      }
      if (!(typeof sid === "string" && Object.hasOwn(sources, sid))) {
        problems.push(`${ewhere}: unknown source ${py(sid)}`);
        continue;
      }
      used.add(sid);
      if (keyedBy !== "observedOn" || entry === latestObserved(fact)) {
        valueChecked.push(entry.checked);
      }
      if (status === "confirmed" && !(isObject(sources[sid]) && truthy(get(sources[sid], "official")))) {
        problems.push(`${ewhere}: confirmed, but its source is not official`);
      }
      if (status === "expected" && !truthy(entry.note)) {
        problems.push(`${ewhere}: expected values need a note explaining how they were worked out`);
      }
      if (keyedBy === "academicYear" && status === "expected") {
        problems.push(`${ewhere}: a value for an academic year must be published, not expected`);
      }
      if (entry.verified === null) {
        problems.push(`${ewhere}: not verified`);
      } else {
        try {
          const checked = parseDate(entry.checked);
          const verified = parseDate(entry.verified);
          if (verified.order < checked.order) {
            problems.push(`${ewhere}: verified before it was checked`);
          }
        } catch (error) {
          if (!(error instanceof BadDate)) {
            throw error;
          }
          problems.push(`${ewhere}: bad date ${error.message}`);
        }
      }

      // Checking that a fact belonging to one institution names it in its label
      const owner = FACT_OWNER[fid] ?? SOURCE_OWNER[`${code}/${sid}`] ?? "general";
      const label = truthy(get(fact, "label")) ? py(fact.label) : "";
      if (owner !== "general" && !label.includes(owner)) {
        problems.push(`${ewhere}: belongs to ${owner}, but the label does not name it`);
      }

      const value = entry.value;
      if (!isObject(value)) {
        problems.push(`${ewhere}: value must be an object`);
        continue;
      }
      if (keyedBy === "testDate" && get(value, "test") !== get(entry, "key")) {
        problems.push(`${ewhere}: key must equal the test day`);
      }
      try {
        checkValue(kind, value, ewhere, problems);
        for (const field of DATE_FIELDS) {
          if (get(value, field) === null) {
            continue;
          }
          const when = parseDate(value[field]);
          // Allowing only a month for an expected date more than a year ahead
          if (status === "expected" && when.precision === "day" && ["date", "from", "to"].includes(field) && when.order > precisionCutoff) {
            problems.push(`${ewhere}: expected date more than a year ahead must be a month only`);
          }
          // Keeping a cycle's dates in its own year or the year before
          if (keyedBy === "cycle" && ["date", "from", "to"].includes(field) && KEY_RE.cycle.test(py(get(entry, "key")))) {
            const cycle = Number(entry.key);
            if (!(cycle - 1 <= when.year && when.year <= cycle)) {
              problems.push(`${ewhere}: ${field} ${py(value[field])} is outside cycle ${cycle}`);
            }
          }
        }
      } catch (error) {
        if (!(error instanceof BadDate)) {
          throw error;
        }
        problems.push(`${ewhere}: bad date ${error.message}`);
      }
    }

    // Holding school years one year short of the intakes, since school ends before studies begin
    const schoolHorizon = horizon - 1;
    if (keyedBy === "hscYear") {
      const years = fact.values.filter((entry) => typeof entry.key === "string" && KEY_RE.hscYear.test(entry.key)).map((entry) => Number(entry.key));
      if (years.length > 0 && Math.max(...years) < schoolHorizon) {
        problems.push(`${fid}: stops at HSC year ${Math.max(...years)}; it must reach ${schoolHorizon}`);
      }
    }
    if (keyedBy === "series") {
      const years = fact.values.filter((entry) => typeof entry.key === "string" && KEY_RE.series.test(entry.key)).map((entry) => Number(entry.key.slice(0, 4)));
      if (years.length > 0 && Math.max(...years) < schoolHorizon) {
        problems.push(`${fid}: stops at series year ${Math.max(...years)}; it must reach ${schoolHorizon}`);
      }
    }
    const cycles = keyedBy === "cycle"
      ? fact.values.filter((entry) => typeof entry.key === "string" && KEY_RE.cycle.test(entry.key)).map((entry) => Number(entry.key))
      : [];
    if (cycles.length > 0) {
      const last = Math.max(...cycles);
      if (last < horizon) {
        problems.push(`${fid}: stops at cycle ${last}; it must reach ${horizon}`);
      }
    }
    if (keyedBy === "academicYear") {
      if (kind !== "money") {
        problems.push(`${fid}: only money facts can be keyed by academicYear`);
      }
      const years = fact.values
        .filter((entry) => typeof entry.key === "string" && KEY_RE.academicYear.test(entry.key))
        .map((entry) => Number(entry.key))
        .sort((a, b) => a - b);
      const current = checkedFile.month >= ACADEMIC_YEAR_START_MONTH ? checkedFile.year : checkedFile.year - 1;
      if (years.length > 0 && years.some((year, index) => year !== years[0] + index)) {
        problems.push(`${fid}: academic years must follow each other with no gaps`);
      }
      if (years.length > 0 && years[years.length - 1] < current) {
        problems.push(`${fid}: stops at academic year ${years[years.length - 1]}; it must reach ${current}`);
      }
      if (years.length > 0 && years[years.length - 1] > checkedFile.year + 1) {
        problems.push(`${fid}: academic year ${years[years.length - 1]} is more than a year ahead`);
      }
    }
  }

  for (const sid of Object.keys(sources)) {
    if (!used.has(sid) && !Object.hasOwn(REFERENCE_ONLY, `${code}/${sid}`)) {
      problems.push(`${code}/${sid}: source is used by no fact and is not listed as reference only`);
    }
  }

  // Refusing a file dated later than its oldest value, since the file's date promises every value was read by then
  const oldest = valueChecked.filter((text) => {
    try {
      parseDate(text);
      return true;
    } catch {
      return false;
    }
  }).sort((a, b) => parseDate(a).order - parseDate(b).order)[0];
  if (oldest !== undefined && parseDate(oldest).order < checkedFile.order) {
    problems.push(`${name}: checked ${data.checked} is later than its oldest value, checked ${oldest}`);
  }

  // Reporting a classification left behind after its source or fact was removed
  for (const key of [...Object.keys(SOURCE_OWNER), ...Object.keys(REFERENCE_ONLY)]) {
    const [owner, sid] = key.split(/\/(.*)/s);
    if (owner === code && !Object.hasOwn(sources, sid)) {
      problems.push(`${key}: listed in the validator, but the file has no such source`);
    }
  }
  for (const key of Object.keys(FACT_OWNER)) {
    const [owner, id] = key.split(/\/(.*)/s);
    if (owner === code && !ids.includes(id)) {
      problems.push(`${key}: listed in the validator, but the file has no such fact`);
    }
  }
}

// Finding the latest observation of a value that changes often; older ones cannot be read again
function latestObserved(fact) {
  return fact.values.reduce((latest, entry) => (String(entry.key) > String(latest.key) ? entry : latest));
}

// Checking a list of { code, name, bytes } files; nameFor gives the expected name of a missing file
export function validateFiles(files, nameFor) {
  const problems = [];
  const counts = { facts: 0, values: 0 };
  for (const file of files) {
    checkFile(file, problems, counts);
  }
  const present = new Set(files.map((file) => file.code));
  for (const key of [...Object.keys(SOURCE_OWNER), ...Object.keys(FACT_OWNER), ...Object.keys(REFERENCE_ONLY)]) {
    const code = key.split("/")[0];
    if (!present.has(code)) {
      problems.push(`${key}: listed in the validator, but ${nameFor(code)} is missing`);
    }
  }
  return { problems, summary: `${files.length} files, ${counts.facts} facts, ${counts.values} values` };
}

export function flatName(code) {
  return `facts-${code}.json`;
}

export function repoName(code) {
  return code === "bd" ? "common/bd.json" : `countries/${code}/facts.json`;
}

export function readFlat(folder) {
  return readdirSync(folder)
    .filter((entry) => /^facts-.+\.json$/.test(entry))
    .sort()
    .map((entry) => ({ code: entry.slice(6, -5), name: entry, bytes: readFileSync(join(folder, entry)) }));
}

export function readRepo(dataFolder) {
  const files = [];
  const common = join(dataFolder, "common", "bd.json");
  if (existsSync(common)) {
    files.push({ code: "bd", name: repoName("bd"), bytes: readFileSync(common) });
  }
  const countries = join(dataFolder, "countries");
  if (existsSync(countries)) {
    for (const code of readdirSync(countries).sort()) {
      const path = join(countries, code, "facts.json");
      if (statSync(join(countries, code)).isDirectory() && existsSync(path)) {
        files.push({ code, name: repoName(code), bytes: readFileSync(path) });
      }
    }
  }
  return files.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
}

function main(args) {
  const flat = args[0] === "--flat";
  const folder = flat ? args[1] : fileURLToPath(new URL("../www/data", import.meta.url));
  if (!folder || !existsSync(folder)) {
    console.log(`no such folder: ${folder}`);
    return 1;
  }
  const files = flat ? readFlat(folder) : readRepo(folder);
  if (files.length === 0) {
    console.log(flat ? `no facts-*.json files in ${folder}` : `no facts files in ${folder}`);
    return 1;
  }
  const { problems, summary } = validateFiles(files, flat ? flatName : repoName);
  console.log(summary);
  console.log(problems.length > 0 ? problems.join("\n") : "No problems found.");
  return problems.length > 0 ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv.slice(2));
}
