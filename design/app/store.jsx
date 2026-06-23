// app/store.jsx — global data store, persistence, sample data
// Exposes window.useStore() and window.StoreProvider via React context.

const STORE_KEY = 'mochi_lms_v2';

// ---- Category color palette (maps to DS category hues) ----
const PALETTE = [
  { id: 'violet', label: 'Violet', soft: 'var(--cat-violet-soft)', base: 'var(--cat-violet)', ink: 'var(--cat-violet-ink)', hex: '#A185E4' },
  { id: 'green',  label: 'Green',  soft: 'var(--cat-green-soft)',  base: 'var(--cat-green)',  ink: 'var(--cat-green-ink)',  hex: '#6FB97A' },
  { id: 'blue',   label: 'Blue',   soft: 'var(--cat-blue-soft)',   base: 'var(--cat-blue)',   ink: 'var(--cat-blue-ink)',   hex: '#57A7D2' },
  { id: 'orange', label: 'Orange', soft: 'var(--cat-orange-soft)', base: 'var(--cat-orange)', ink: 'var(--cat-orange-ink)', hex: '#F79A4E' },
  { id: 'cocoa',  label: 'Cocoa',  soft: '#F2E5DA',                base: '#A9744F',           ink: '#6E472C',               hex: '#A9744F' },
  { id: 'rose',   label: 'Rose',   soft: '#FBE3DD',                base: '#DC6A52',           ink: '#a23a25',               hex: '#DC6A52' },
];
window.MOCHI_PALETTE = PALETTE;
window.colorOf = (id) => PALETTE.find(p => p.id === id) || PALETTE[0];

// ---- Date helpers (anchored to a fixed "today" for a stable demo) ----
const TODAY = new Date();
TODAY.setHours(0, 0, 0, 0);
const iso = (d) => {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
};
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
window.MOCHI_DATE = { TODAY, iso, addDays };

function makeCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s.slice(0, 3) + '-' + s.slice(3);
}
window.makeCode = makeCode;

// ---- Seed / sample data (minimal) ----
function seed() {
  const t = iso(TODAY);
  const classes = [
    { id: 'c1', name: 'Biology 9A', subject: 'Science', color: 'green',  room: 'Room 204', schedule: [{ day: 1, start: '09:00', end: '09:45' }, { day: 3, start: '09:00', end: '09:45' }], studentIds: ['s1', 's2', 's3'] },
    { id: 'c2', name: 'Algebra II',  subject: 'Math',    color: 'blue',   room: 'Room 110', schedule: [{ day: 2, start: '11:00', end: '11:50' }, { day: 4, start: '11:00', end: '11:50' }], studentIds: ['s2', 's4'] },
    { id: 'c3', name: 'World Lit',   subject: 'English', color: 'violet', room: 'Room 301', schedule: [{ day: 1, start: '13:00', end: '13:50' }, { day: 5, start: '13:00', end: '13:50' }], studentIds: ['s1', 's3', 's4'] },
    { id: 'c4', name: 'Studio Art',  subject: 'Art',     color: 'orange', room: 'Studio B', schedule: [{ day: 3, start: '15:00', end: '16:00' }], studentIds: ['s3'] },
  ];
  const students = [
    { id: 's1', name: 'Leo Park',     grade: '9', color: 'green',  guardian: 'Mina Park',    email: 'leo@school.edu',   classIds: ['c1', 'c3'] },
    { id: 's2', name: 'Mia Chen',     grade: '9', color: 'blue',   guardian: 'David Chen',   email: 'mia@school.edu',   classIds: ['c1', 'c2'] },
    { id: 's3', name: 'Ada Rivera',   grade: '9', color: 'violet', guardian: 'Sofia Rivera', email: 'ada@school.edu',   classIds: ['c1', 'c3', 'c4'] },
    { id: 's4', name: 'Noah Bennett', grade: '9', color: 'orange', guardian: 'Greg Bennett', email: 'noah@school.edu',  classIds: ['c2', 'c3'] },
  ];
  const users = [
    { id: 'u1', name: 'Sam Okafor',  email: 'sam@school.edu',  role: 'Admin',   color: 'orange', phone: '(555) 010-2280' },
    { id: 'u2', name: 'Priya Nair',  email: 'priya@school.edu', role: 'Teacher', color: 'violet', phone: '(555) 010-7741' },
  ];
  const events = [
    { id: 'e1', title: 'Biology 9A',     date: t,                 start: '09:00', end: '09:45', color: 'green',  classId: 'c1', location: 'Room 204', recurrence: 'weekly' },
    { id: 'e2', title: 'Algebra II',     date: iso(addDays(TODAY, 1)), start: '11:00', end: '11:50', color: 'blue',   classId: 'c2', location: 'Room 110', recurrence: 'weekly' },
    { id: 'e3', title: 'Staff meeting',  date: t,                 start: '15:30', end: '16:15', color: 'cocoa',  classId: null, location: 'Library',  recurrence: 'none' },
    { id: 'e4', title: 'World Lit',      date: t,                 start: '13:00', end: '13:50', color: 'violet', classId: 'c3', location: 'Room 301', recurrence: 'weekly' },
    { id: 'e5', title: 'Studio Art',     date: iso(addDays(TODAY, 2)), start: '15:00', end: '16:00', color: 'orange', classId: 'c4', location: 'Studio B', recurrence: 'weekly' },
    { id: 'e6', title: 'Science fair',   date: iso(addDays(TODAY, 4)), start: '10:00', end: '12:00', color: 'green',  classId: 'c1', location: 'Gym',      recurrence: 'none' },
    { id: 'e7', title: 'Parent night',   date: iso(addDays(TODAY, 5)), start: '18:00', end: '19:30', color: 'rose',   classId: null, location: 'Hall',     recurrence: 'none' },
  ];
  const homework = [
    { id: 'h1', title: 'Cell diagram lab',     classId: 'c1', due: t,                       done: false, color: 'green',  points: 20, notes: 'Label all organelles. Hand in the worksheet with your diagram.' },
    { id: 'h2', title: 'Quadratics, set 4',    classId: 'c2', due: iso(addDays(TODAY, 1)),  done: false, color: 'blue',   points: 15, notes: 'Questions 1–12, show your working.' },
    { id: 'h3', title: 'Read chapters 5–6',    classId: 'c3', due: iso(addDays(TODAY, 2)),  done: false, color: 'violet', points: 10, notes: 'Be ready to discuss the theme of memory.' },
    { id: 'h4', title: 'Color wheel study',    classId: 'c4', due: iso(addDays(TODAY, -1)), done: false, color: 'orange', points: 25, notes: 'Primary, secondary and tertiary colors in gouache.' },
    { id: 'h5', title: 'Vocab quiz prep',      classId: 'c3', due: t,                       done: true,  color: 'violet', points: 10, notes: '' },
  ];
  const materials = [
    { id: 'm1', title: 'Photosynthesis slides', type: 'notes',     classId: 'c1', url: '', fileName: 'photosynthesis.pdf', favorite: true,  addedAt: t },
    { id: 'm2', title: 'Khan: Quadratics',      type: 'link',      classId: 'c2', url: 'https://khanacademy.org', fileName: '', favorite: false, addedAt: t },
    { id: 'm3', title: 'Essay rubric',          type: 'worksheet', classId: 'c3', url: '', fileName: 'rubric.docx', favorite: true,  addedAt: t },
    { id: 'm4', title: 'Intro to color theory', type: 'video',     classId: 'c4', url: 'https://youtube.com', fileName: '', favorite: false, addedAt: t },
  ];
  const invites = [
    { id: 'i1', code: makeCode(), role: 'Student', name: 'Ivy Tran', classId: 'c1', createdAt: t, used: false },
    { id: 'i2', code: makeCode(), role: 'Parent',  name: 'Mina Park (Leo)', classId: null, createdAt: t, used: true },
  ];
  const parents = [
    { id: 'p1', name: 'Mina Park',    email: 'mina.park@home.com',   phone: '(555) 240-1180', color: 'green',  studentIds: ['s1'], relation: 'Mother' },
    { id: 'p2', name: 'David Chen',   email: 'david.chen@home.com',  phone: '(555) 240-7732', color: 'blue',   studentIds: ['s2'], relation: 'Father' },
    { id: 'p3', name: 'Sofia Rivera', email: 'sofia.rivera@home.com', phone: '', color: 'violet', studentIds: ['s3'], relation: 'Mother' },
    { id: 'p4', name: 'Greg Bennett', email: 'greg.bennett@home.com', phone: '(555) 240-9026', color: 'orange', studentIds: ['s4'], relation: 'Father' },
  ];
  const theme = {
    bg: '#FFFCF8',        // calendar canvas
    gridLine: '#ECE0CF',  // grid hairlines
    today: '#FFE7D1',     // today column tint
    header: '#FDF6EC',    // day header strip
    bgImage: '',          // optional background image url
    bgOpacity: 0.12,
  };
  return { classes, students, users, events, homework, materials, invites, parents, theme };
}

function load() {
  const s = seed();
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      // merge any collections added after this store was first cached
      return { ...s, ...saved };
    }
  } catch (e) {}
  try { localStorage.setItem(STORE_KEY, JSON.stringify(s)); } catch (e) {}
  return s;
}

const StoreCtx = React.createContext(null);

function StoreProvider({ children }) {
  const [data, setData] = React.useState(load);

  React.useEffect(() => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); } catch (e) {}
  }, [data]);

  const api = React.useMemo(() => {
    const upd = (key, fn) => setData(d => ({ ...d, [key]: fn(d[key]) }));
    const uid = (p) => p + Math.random().toString(36).slice(2, 8);
    return {
      // collections
      add: (key, item) => upd(key, list => [...list, { id: uid(key[0]), ...item }]),
      update: (key, id, patch) => upd(key, list => list.map(x => x.id === id ? { ...x, ...patch } : x)),
      remove: (key, id) => upd(key, list => list.filter(x => x.id !== id)),
      // theme
      setTheme: (patch) => setData(d => ({ ...d, theme: { ...d.theme, ...patch } })),
      // reset
      reset: () => { const s = seed(); setData(s); },
      uid,
    };
  }, []);

  return React.createElement(StoreCtx.Provider, { value: { data, ...api } }, children);
}

function useStore() {
  const ctx = React.useContext(StoreCtx);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
}

window.StoreProvider = StoreProvider;
window.useStore = useStore;
