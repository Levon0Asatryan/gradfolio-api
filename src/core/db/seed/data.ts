/**
 * Development and demo data (tracker 1.10): students writing in Armenian,
 * Russian and English, with the projects, teams and notifications a real
 * portfolio has.
 *
 * Ids are fixed, so notification links point at real rows (issue S12) and a
 * re-run replaces exactly these rows. Rules the data follows:
 * - a project's owner is `projects.user_id` and never a team-member row (S11;
 *   the tracker's proposed Q4);
 * - every URL is absolute http(s); every month is YYYY-MM;
 * - seed.test.ts runs each value through the validators the API uses.
 */

export const SEED_USERS = {
  anahit: 'a1000000-0000-4000-8000-000000000001',
  dmitri: 'a1000000-0000-4000-8000-000000000002',
  emily: 'a1000000-0000-4000-8000-000000000003',
  tigran: 'a1000000-0000-4000-8000-000000000004',
  maria: 'a1000000-0000-4000-8000-000000000005',
  narek: 'a1000000-0000-4000-8000-000000000006',
} as const;

export const SEED_PROJECTS = {
  gradfolio: 'b2000000-0000-4000-8000-000000000001',
  metroRoute: 'b2000000-0000-4000-8000-000000000002',
  wineQuality: 'b2000000-0000-4000-8000-000000000003',
  armenianOcr: 'b2000000-0000-4000-8000-000000000004',
  hackathonBot: 'b2000000-0000-4000-8000-000000000005',
  designSystem: 'b2000000-0000-4000-8000-000000000006',
  importedCli: 'b2000000-0000-4000-8000-000000000007',
  privateThesis: 'b2000000-0000-4000-8000-000000000008',
} as const;

type UserId = (typeof SEED_USERS)[keyof typeof SEED_USERS];
type ProjectId = (typeof SEED_PROJECTS)[keyof typeof SEED_PROJECTS];

export interface SeedUser {
  id: UserId;
  auth0Id: string;
  name: string;
  headline: string;
  location: string;
  bio: string;
  email: string;
  avatarUrl: string;
  github: string | null;
  linkedin: string | null;
  website: string | null;
  isPublic: boolean;
  verified: boolean;
  skills: string[];
  education: {
    institution: string;
    degree: string;
    field: string;
    startYear: number;
    endYear: number | null;
    description: string;
    highlights: string[];
  }[];
  experience: {
    title: string;
    organization: string;
    start: string;
    end: string | null;
    summary: string;
    achievements: string[];
    skills: string[];
  }[];
  certifications: { name: string; issuer: string; date: string; credentialUrl: string }[];
}

export const users: SeedUser[] = [
  {
    id: SEED_USERS.anahit,
    auth0Id: 'seed|anahit-sargsyan',
    name: 'Անահիտ Սարգսյան',
    headline: 'Համակարգչային գիտություն, ՀԱՊՀ — Full-stack ծրագրավորող',
    location: 'Երևան, Հայաստան',
    bio: 'Ստեղծում եմ գործիքներ, որոնք օգնում են ուսանողներին ցույց տալ իրենց աշխատանքը։',
    email: 'anahit.sargsyan@example.com',
    avatarUrl: 'https://i.pravatar.cc/300?u=anahit',
    github: 'https://github.com/anahit-sargsyan-demo',
    linkedin: 'https://www.linkedin.com/in/anahit-sargsyan-demo',
    website: null,
    isPublic: true,
    verified: true,
    skills: ['TypeScript', 'React', 'Node.js', 'MySQL', 'Docker'],
    education: [
      {
        institution: 'Հայաստանի ազգային պոլիտեխնիկական համալսարան (ՀԱՊՀ)',
        degree: 'Բակալավր',
        field: 'Համակարգչային գիտություն',
        startYear: 2022,
        endYear: null,
        description: 'Ծրագրային ճարտարագիտություն և վեբ տեխնոլոգիաներ։',
        highlights: ['Դեկանի պատվոգիր 2024', 'Ավարտական նախագիծ՝ Gradfolio'],
      },
    ],
    experience: [
      {
        title: 'Frontend Developer Intern',
        organization: 'Picsart',
        start: '2024-06',
        end: '2024-09',
        summary: 'Built dashboard components and fixed accessibility issues.',
        achievements: ['Shipped 3 dashboard widgets', 'Cut bundle size by 12%'],
        skills: ['React', 'TypeScript'],
      },
    ],
    certifications: [
      {
        name: 'Meta Front-End Developer',
        issuer: 'Coursera / Meta',
        date: '2024-03',
        credentialUrl: 'https://www.coursera.org/verify/demo-anahit',
      },
    ],
  },
  {
    id: SEED_USERS.dmitri,
    auth0Id: 'seed|dmitri-volkov',
    name: 'Дмитрий Волков',
    headline: 'Студент РАУ, прикладная математика — бэкенд и данные',
    location: 'Ереван, Армения',
    bio: 'Люблю распределённые системы, Go и хорошие тесты.',
    email: 'dmitri.volkov@example.com',
    avatarUrl: 'https://i.pravatar.cc/300?u=dmitri',
    github: 'https://github.com/dmitri-volkov-demo',
    linkedin: null,
    website: 'https://dmitri-volkov.example.com',
    isPublic: true,
    verified: false,
    skills: ['Go', 'PostgreSQL', 'Kubernetes', 'Python'],
    education: [
      {
        institution: 'Российско-Армянский университет (РАУ)',
        degree: 'Бакалавр',
        field: 'Прикладная математика и информатика',
        startYear: 2021,
        endYear: 2025,
        description: 'Алгоритмы, базы данных, параллельные вычисления.',
        highlights: ['Финалист олимпиады ICPC (полуфинал)'],
      },
    ],
    experience: [
      {
        title: 'Backend Engineer (part-time)',
        organization: 'SoftConstruct',
        start: '2024-02',
        end: null,
        summary: 'Сервисы на Go для обработки платежей.',
        achievements: ['Снизил p99 задержку на 30%'],
        skills: ['Go', 'Kafka'],
      },
    ],
    certifications: [],
  },
  {
    id: SEED_USERS.emily,
    auth0Id: 'seed|emily-carter',
    name: 'Emily Carter',
    headline: 'Data Science student at AUA — ML for low-resource languages',
    location: 'Yerevan, Armenia',
    bio: 'Exchange student working on OCR and NLP for Armenian script.',
    email: 'emily.carter@example.com',
    avatarUrl: 'https://i.pravatar.cc/300?u=emily',
    github: 'https://github.com/emily-carter-demo',
    linkedin: 'https://www.linkedin.com/in/emily-carter-demo',
    website: null,
    isPublic: true,
    verified: true,
    skills: ['Python', 'PyTorch', 'Machine Learning', 'AI'],
    education: [
      {
        institution: 'American University of Armenia',
        degree: 'Master of Science',
        field: 'Data Science',
        startYear: 2024,
        endYear: null,
        description: 'Machine learning, statistics and data engineering.',
        highlights: ['Research assistant, AUA NLP group'],
      },
    ],
    experience: [],
    certifications: [
      {
        name: 'TensorFlow Developer Certificate',
        issuer: 'Google',
        date: '2023-11',
        credentialUrl: 'https://www.credential.net/demo-emily',
      },
    ],
  },
  {
    id: SEED_USERS.tigran,
    auth0Id: 'seed|tigran-hakobyan',
    name: 'Tigran Hakobyan',
    headline: 'Տվյալագիտություն, ԵՊՀ · Data engineering',
    location: 'Gyumri, Armenia',
    bio: 'Wine, data and dashboards. Գյումրիից։',
    email: 'tigran.hakobyan@example.com',
    avatarUrl: 'https://i.pravatar.cc/300?u=tigran',
    github: 'https://github.com/tigran-hakobyan-demo',
    linkedin: null,
    website: null,
    isPublic: true,
    verified: false,
    skills: ['Python', 'SQL', 'Pandas', 'Go'],
    education: [
      {
        institution: 'Երևանի պետական համալսարան (ԵՊՀ)',
        degree: 'Bachelor of Science',
        field: 'Data Science',
        startYear: 2021,
        endYear: 2025,
        description: 'Statistics, machine learning and data engineering.',
        highlights: [],
      },
    ],
    experience: [],
    certifications: [],
  },
  {
    id: SEED_USERS.maria,
    auth0Id: 'seed|maria-petrosyan',
    name: 'Мария Петросян',
    headline: 'UX/UI дизайнер, НПУА — дизайн-системы',
    location: 'Ереван, Армения',
    bio: 'Проектирую интерфейсы, которые понятны с первого взгляда.',
    email: 'maria.petrosyan@example.com',
    avatarUrl: 'https://i.pravatar.cc/300?u=maria',
    github: null,
    linkedin: 'https://www.linkedin.com/in/maria-petrosyan-demo',
    website: 'https://maria-petrosyan.example.com',
    isPublic: true,
    verified: true,
    skills: ['Figma', 'UX Research', 'CSS', 'React'],
    education: [
      {
        institution: 'Национальный политехнический университет Армении (НПУА)',
        degree: 'Бакалавр',
        field: 'Информационные технологии',
        startYear: 2022,
        endYear: null,
        description: 'Взаимодействие человека и компьютера.',
        highlights: ['Лучший UX-проект курса 2024'],
      },
    ],
    experience: [
      {
        title: 'UX Design Intern',
        organization: 'Krisp',
        start: '2025-01',
        end: '2025-04',
        summary: 'Исследования пользователей и прототипы онбординга.',
        achievements: ['Провела 14 интервью с пользователями'],
        skills: ['Figma', 'UX Research'],
      },
    ],
    certifications: [
      {
        name: 'Google UX Design Certificate',
        issuer: 'Coursera / Google',
        date: '2024-08',
        credentialUrl: 'https://www.coursera.org/verify/demo-maria',
      },
    ],
  },
  {
    id: SEED_USERS.narek,
    auth0Id: 'seed|narek-grigoryan',
    name: 'Narek Grigoryan',
    headline: 'Private profile — visible to its owner only',
    location: 'Vanadzor, Armenia',
    bio: 'Keeps the profile private while applying for jobs.',
    email: 'narek.grigoryan@example.com',
    avatarUrl: 'https://i.pravatar.cc/300?u=narek',
    github: null,
    linkedin: null,
    website: null,
    isPublic: false,
    verified: false,
    skills: ['Java', 'Spring'],
    education: [],
    experience: [],
    certifications: [],
  },
];

export interface SeedProject {
  id: ProjectId;
  owner: UserId;
  title: string;
  summary: string;
  descriptionHtml: string;
  category: 'academic' | 'personal' | 'research' | 'hackathon' | 'course' | 'other';
  status: 'ongoing' | 'completed' | 'archived';
  isPublic: boolean;
  isDraft: boolean;
  source: 'manual' | 'github';
  heroImageUrl: string | null;
  liveDemoUrl: string | null;
  repoUrl: string | null;
  githubRepoId: number | null;
  repoStars: number | null;
  repoForks: number | null;
  repoLanguage: string | null;
  metaStartDate: string | null;
  metaEndDate: string | null;
  metaCourse: string | null;
  metaProfessor: string | null;
  technologies: string[];
  tags: string[];
  links: { label: string; url: string }[];
  files: { label: string; url: string }[];
  attachments: { type: 'image' | 'video' | 'pdf' | 'link'; url: string; title: string }[];
  team: {
    user: UserId | null;
    name: string;
    role: string;
    status: 'pending' | 'accepted' | 'rejected';
  }[];
}

const project = (
  p: Partial<SeedProject> & Pick<SeedProject, 'id' | 'owner' | 'title'>,
): SeedProject => ({
  summary: '',
  descriptionHtml: '',
  category: 'personal',
  status: 'completed',
  isPublic: true,
  isDraft: false,
  source: 'manual',
  heroImageUrl: null,
  liveDemoUrl: null,
  repoUrl: null,
  githubRepoId: null,
  repoStars: null,
  repoForks: null,
  repoLanguage: null,
  metaStartDate: null,
  metaEndDate: null,
  metaCourse: null,
  metaProfessor: null,
  technologies: [],
  tags: [],
  links: [],
  files: [],
  attachments: [],
  team: [],
  ...p,
});

export const projects: SeedProject[] = [
  project({
    id: SEED_PROJECTS.gradfolio,
    owner: SEED_USERS.anahit,
    title: 'Gradfolio — ուսանողական պորտֆոլիո',
    summary:
      'Հարթակ, որտեղ ուսանողները ներկայացնում են իրենց նախագծերը, հմտություններն ու ձեռքբերումները։',
    descriptionHtml:
      '<h2>Խնդիր</h2><p>Ուսանողական աշխատանքները ցրված են GitHub-ում և LinkedIn-ում։</p><h2>Լուծում</h2><ul><li>Պրոֆիլ՝ կրթությամբ և փորձով</li><li>Նախագծեր՝ թիմով և ապացույցներով</li></ul>',
    category: 'course',
    status: 'ongoing',
    heroImageUrl: 'https://images.unsplash.com/photo-1517694712202-14dd9538aa97',
    liveDemoUrl: 'https://gradfolio.vercel.app',
    repoUrl: 'https://github.com/anahit-sargsyan-demo/gradfolio',
    metaStartDate: '2025-09-01',
    metaCourse: 'Ծրագրային ճարտարագիտություն',
    metaProfessor: 'Պրոֆ. Հարությունյան',
    technologies: ['Next.js', 'TypeScript', 'NestJS', 'MySQL', 'Auth0'],
    tags: ['capstone', 'full-stack', 'portfolio'],
    links: [{ label: 'Figma', url: 'https://www.figma.com/file/demo-gradfolio' }],
    files: [{ label: 'Specification', url: 'https://files.example.com/gradfolio/spec.pdf' }],
    attachments: [
      {
        type: 'image',
        url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f',
        title: 'Dashboard',
      },
      {
        type: 'video',
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        title: 'Demo walkthrough',
      },
    ],
    team: [
      {
        user: SEED_USERS.maria,
        name: 'Мария Петросян',
        role: 'UI/UX Designer',
        status: 'accepted',
      },
      {
        user: SEED_USERS.dmitri,
        name: 'Дмитрий Волков',
        role: 'Backend Developer',
        status: 'pending',
      },
      { user: null, name: 'Aram Manukyan', role: 'QA Tester', status: 'accepted' },
    ],
  }),
  project({
    id: SEED_PROJECTS.metroRoute,
    owner: SEED_USERS.dmitri,
    title: 'Маршруты ереванского метро',
    summary: 'Сервис на Go, который строит маршруты по метро и автобусам Еревана.',
    descriptionHtml: '<p>Граф остановок, алгоритм Дейкстры и REST API.</p>',
    category: 'personal',
    repoUrl: 'https://github.com/dmitri-volkov-demo/metro-route',
    technologies: ['Go', 'PostgreSQL', 'Docker'],
    tags: ['transport', 'graphs'],
    team: [{ user: SEED_USERS.tigran, name: 'Tigran Hakobyan', role: 'Data', status: 'rejected' }],
  }),
  project({
    id: SEED_PROJECTS.wineQuality,
    owner: SEED_USERS.tigran,
    title: 'Armenian Wine Quality Predictor',
    summary: 'ML model predicting wine quality from the chemistry of Armenian wines.',
    descriptionHtml:
      '<h2>Dataset</h2><p>1,200 samples from 5 wineries.</p><h2>Results</h2><p>Random forest, 89% accuracy.</p>',
    category: 'research',
    metaStartDate: '2024-09-01',
    metaEndDate: '2024-12-15',
    metaCourse: 'Machine Learning',
    metaProfessor: 'Prof. Davtyan',
    technologies: ['Python', 'scikit-learn', 'pandas', 'ML'],
    tags: ['machine-learning', 'wine'],
    files: [{ label: 'Dataset', url: 'https://files.example.com/wine-quality/data.csv' }],
    attachments: [
      { type: 'pdf', url: 'https://files.example.com/wine-quality/report.pdf', title: 'Report' },
    ],
    team: [{ user: SEED_USERS.emily, name: 'Emily Carter', role: 'Modelling', status: 'accepted' }],
  }),
  project({
    id: SEED_PROJECTS.armenianOcr,
    owner: SEED_USERS.emily,
    title: 'OCR for handwritten Armenian',
    summary: 'A small CNN that reads handwritten Armenian letters, with a labelled dataset.',
    descriptionHtml: '<p>Trained on 40k letters collected from volunteers.</p>',
    category: 'research',
    status: 'ongoing',
    technologies: ['Python', 'PyTorch', 'AI'],
    tags: ['ocr', 'nlp', 'armenian'],
    links: [{ label: 'Paper draft', url: 'https://arxiv.org/abs/0000.00000' }],
  }),
  project({
    id: SEED_PROJECTS.hackathonBot,
    owner: SEED_USERS.anahit,
    title: 'Telegram bot for university schedules',
    summary: 'Built in 36 hours at Hackathon Armenia: timetables and room changes in Telegram.',
    descriptionHtml: '<p>Scrapes the public timetable and notifies on changes.</p>',
    category: 'hackathon',
    technologies: ['Node.js', 'TypeScript', 'Redis'],
    tags: ['hackathon', 'bot'],
    attachments: [{ type: 'link', url: 'https://t.me/demo_schedule_bot', title: 'Try the bot' }],
  }),
  project({
    id: SEED_PROJECTS.designSystem,
    owner: SEED_USERS.maria,
    title: 'Дизайн-система для студенческих сервисов',
    summary: 'Компоненты, токены и гайдлайны на трёх языках.',
    descriptionHtml: '<p>Токены цвета и типографики, 40 компонентов в Figma.</p>',
    category: 'academic',
    technologies: ['Figma', 'React', 'CSS'],
    tags: ['design-system', 'i18n'],
    team: [
      { user: SEED_USERS.anahit, name: 'Անահիտ Սարգսյան', role: 'Frontend', status: 'accepted' },
    ],
  }),
  project({
    id: SEED_PROJECTS.importedCli,
    owner: SEED_USERS.dmitri,
    title: 'go-migrate-lite',
    summary: 'Imported from GitHub; not published yet.',
    category: 'personal',
    status: 'ongoing',
    isDraft: true,
    source: 'github',
    repoUrl: 'https://github.com/dmitri-volkov-demo/go-migrate-lite',
    githubRepoId: 812345678,
    repoStars: 42,
    repoForks: 7,
    repoLanguage: 'Go',
    technologies: ['Go'],
  }),
  project({
    id: SEED_PROJECTS.privateThesis,
    owner: SEED_USERS.emily,
    title: 'Thesis draft (private)',
    summary: 'Visible to its owner only.',
    category: 'academic',
    status: 'ongoing',
    isPublic: false,
    technologies: ['Python'],
  }),
];

export interface SeedNotification {
  user: UserId;
  type: 'team_invite' | 'team_accepted' | 'team_rejected';
  title: string;
  message: string;
  isRead: boolean;
  project: ProjectId;
}

/** Each one is about a team row above; its link is built from the project id. */
export const notifications: SeedNotification[] = [
  {
    user: SEED_USERS.dmitri,
    type: 'team_invite',
    title: 'Приглашение в команду',
    message: 'Անահիտ Սարգսյան пригласила вас в «Gradfolio» как Backend Developer',
    isRead: false,
    project: SEED_PROJECTS.gradfolio,
  },
  {
    user: SEED_USERS.anahit,
    type: 'team_accepted',
    title: 'Հրավերն ընդունված է',
    message: 'Мария Петросян-ը միացավ «Gradfolio» նախագծին',
    isRead: true,
    project: SEED_PROJECTS.gradfolio,
  },
  {
    user: SEED_USERS.dmitri,
    type: 'team_rejected',
    title: 'Приглашение отклонено',
    message: 'Tigran Hakobyan declined the invitation to «Маршруты ереванского метро»',
    isRead: false,
    project: SEED_PROJECTS.metroRoute,
  },
  {
    user: SEED_USERS.tigran,
    type: 'team_accepted',
    title: 'Invitation accepted',
    message: 'Emily Carter joined “Armenian Wine Quality Predictor”',
    isRead: true,
    project: SEED_PROJECTS.wineQuality,
  },
];

export interface SeedActivity {
  user: UserId;
  type: 'project' | 'profile';
  translationKey: string;
  translationParams: Record<string, string | number>;
  timestamp: string;
}

export const activities: SeedActivity[] = [
  {
    user: SEED_USERS.anahit,
    type: 'project',
    translationKey: 'projectUpdated',
    translationParams: { projectName: 'Gradfolio' },
    timestamp: '2026-09-20T10:00:00Z',
  },
  {
    user: SEED_USERS.anahit,
    type: 'profile',
    translationKey: 'newSkill',
    translationParams: { skillName: 'Docker' },
    timestamp: '2026-09-18T08:30:00Z',
  },
  {
    user: SEED_USERS.dmitri,
    type: 'project',
    translationKey: 'projectCreated',
    translationParams: { projectName: 'go-migrate-lite' },
    timestamp: '2026-09-22T17:45:00Z',
  },
  {
    user: SEED_USERS.emily,
    type: 'project',
    translationKey: 'projectUpdated',
    translationParams: { projectName: 'OCR for handwritten Armenian', count: 3 },
    timestamp: '2026-09-25T12:15:00Z',
  },
  {
    user: SEED_USERS.maria,
    type: 'profile',
    translationKey: 'newSkill',
    translationParams: { skillName: 'UX Research' },
    timestamp: '2026-09-10T09:00:00Z',
  },
];

/** GitHub linked for the user who imported a repository; no tokens in seed data. */
export const integrations: {
  user: UserId;
  type: 'github' | 'linkedin';
  status: 'connected' | 'not_connected';
  lastSyncedAt: string | null;
}[] = [
  {
    user: SEED_USERS.dmitri,
    type: 'github',
    status: 'connected',
    lastSyncedAt: '2026-09-22T17:40:00Z',
  },
  { user: SEED_USERS.anahit, type: 'github', status: 'not_connected', lastSyncedAt: null },
];
