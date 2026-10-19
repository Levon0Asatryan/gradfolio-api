import { Secret } from '../upstream/secret.js';

/**
 * A user's GitHub access token, as Auth0 holds it. Held in memory only, never
 * written to MySQL (0008's CHECK), a log or a response: it prints as
 * `[redacted]` however it is printed (docs/modules/m7/plan.md §2.2).
 */
export class GithubAccessToken extends Secret {}
