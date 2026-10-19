import { z } from 'zod';

/**
 * GitHub connect and the integrations card (docs/modules/m7/plan.md §2.3, §4.4, §7
 * items 1–4). No response carries a token, a nonce hash, or the GitHub numeric
 * id (`external_user_id`): only the owner's own GitHub login.
 */

const connectionStatus = z.enum(['connected', 'not_connected']).meta({
  description:
    '`connected` only once GitHub (or Auth0, for LinkedIn) confirmed it; a link still in ' +
    'progress reads `not_connected`.',
});

const timestamp = z.string().nullable().meta({ description: 'ISO 8601, UTC.' });

export const integrationsResponseSchema = z
  .object({
    github: z.object({
      available: z.boolean().meta({
        description:
          'false when the server is not configured for GitHub: every GitHub route then answers ' +
          '503 INTEGRATION_UNAVAILABLE.',
      }),
      status: connectionStatus,
      login: z
        .string()
        .nullable()
        .meta({ description: 'The connected GitHub login; null when not connected.' }),
      lastSyncedAt: timestamp,
    }),
    linkedin: z.object({
      status: connectionStatus.meta({
        description:
          '`connected` when the caller signs in with LinkedIn (derived from the access token, ' +
          'not stored).',
      }),
      lastSyncedAt: timestamp.meta({ description: 'The last confirmed export import; ISO 8601.' }),
    }),
  })
  .meta({ id: 'Integrations' });
export type IntegrationsResponse = z.infer<typeof integrationsResponseSchema>;

const connected = z.object({
  state: z.literal('connected'),
  login: z.string().meta({ description: 'The GitHub login now connected.' }),
});

export const connectResponseSchema = z
  .discriminatedUnion('state', [
    connected,
    z.object({
      state: z.literal('link_required'),
      nonce: z.string().meta({
        description:
          'Single use, bound to the caller. Pass it as `nonce` to Auth0’s `/authorize` ' +
          '(`connection=github`, in a transaction separate from the session), then send the ' +
          'callback’s `id_token` to `POST /v1/me/integrations/github/link`. Never store it.',
      }),
      expiresAt: z.string().meta({ description: 'ISO 8601, UTC; the nonce is refused after it.' }),
    }),
  ])
  .meta({ id: 'GithubConnectResult' });
export type ConnectResponse = z.infer<typeof connectResponseSchema>;

export const linkRequestSchema = z.strictObject({
  idToken: z
    .string()
    .min(1)
    .max(16_384)
    .meta({
      description:
        'The id token of the secondary GitHub sign-in started with the nonce from `connect`. ' +
        'Verified (RS256, issuer, audience, expiry, issued within 5 minutes, a GitHub `sub`, the ' +
        'nonce), used once, never stored or logged.',
    }),
});
export type LinkRequest = z.infer<typeof linkRequestSchema>;

export const linkResponseSchema = connected.meta({ id: 'GithubConnected' });
export type LinkResponse = z.infer<typeof linkResponseSchema>;

export const disconnectResponseSchema = z.object({ status: z.literal('not_connected') });
export type DisconnectResponse = z.infer<typeof disconnectResponseSchema>;
