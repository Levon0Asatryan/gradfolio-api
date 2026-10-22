const copy = {
  en: {
    subject: 'Team invitation on Gradfolio',
    invite: (name: string, project: string) => `${name} invited you to join ${project}.`,
    open: 'Open your invitations',
    unsubscribe: 'Turn off invitation emails',
  },
  ru: {
    subject: 'Приглашение в команду Gradfolio',
    invite: (name: string, project: string) => `${name} приглашает вас в проект «${project}».`,
    open: 'Открыть приглашения',
    unsubscribe: 'Отключить письма с приглашениями',
  },
  am: {
    subject: 'Թիմի հրավեր Gradfolio-ում',
    invite: (name: string, project: string) =>
      `${name}-ը հրավիրել է քեզ միանալու «${project}» նախագծին։`,
    open: 'Բացել հրավերները',
    unsubscribe: 'Անջատել հրավերների նամակները',
  },
} as const;

const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

export function inviteEmail(
  language: keyof typeof copy,
  actor: string,
  project: string,
  appUrl: string,
  token: string,
) {
  const t = copy[language];
  const teams = new URL('/teams', appUrl).href;
  // The token lives in a fragment: it is not sent in GET URLs or referrers to the server.
  const unsubscribe = `${new URL('/email/unsubscribe', appUrl).href}#${token}`;
  const message = t.invite(actor, project);
  return {
    subject: t.subject,
    html: `<html lang="${language === 'am' ? 'hy' : language}"><body><p>${escape(message)}</p><p><a href="${escape(teams)}">${escape(t.open)}</a></p><p><a href="${escape(unsubscribe)}">${escape(t.unsubscribe)}</a></p></body></html>`,
    text: `${message}\n\n${t.open}: ${teams}\n\n${t.unsubscribe}: ${unsubscribe}`,
  };
}
