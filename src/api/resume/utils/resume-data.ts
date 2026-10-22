export interface ResumeData {
  name: string;
  headline: string;
  blocks: { title: string; entries: { title?: string; text: string; url?: string }[] }[];
}

export const RESUME_LABELS = {
  en: {
    contact: 'Contact',
    bio: 'About',
    education: 'Education',
    experience: 'Experience',
    projects: 'Projects',
    skills: 'Skills',
    certifications: 'Certifications',
    present: 'Present',
  },
  ru: {
    contact: 'Контакты',
    bio: 'О себе',
    education: 'Образование',
    experience: 'Опыт работы',
    projects: 'Проекты',
    skills: 'Навыки',
    certifications: 'Сертификаты',
    present: 'По настоящее время',
  },
  am: {
    contact: 'Կոնտակտներ',
    bio: 'Իմ մասին',
    education: 'Կրթություն',
    experience: 'Աշխատանքային փորձ',
    projects: 'Նախագծեր',
    skills: 'Հմտություններ',
    certifications: 'Հավաստագրեր',
    present: 'Մինչ օրս',
  },
} as const;

/** PDF links are annotations: validate their schemes even for legacy rows. */
export function resumeUrl(value: string | null): string | undefined {
  if (!value) return undefined;
  const url = URL.parse(value);
  return url && ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password
    ? url.href
    : undefined;
}
