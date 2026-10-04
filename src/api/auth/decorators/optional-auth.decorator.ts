import { SetMetadata } from '@nestjs/common';
import { IS_OPTIONAL_AUTH } from '../auth.constants.js';

/**
 * The route is readable without a token, and knows the caller when one is sent
 * (a public profile: anonymous visitors read it, the owner also sees their own
 * private data). Only an *absent* `Authorization` header makes the caller
 * anonymous: a header that is present is verified as on any route, so a bad or
 * expired token stays 401 rather than silently degrading to anonymous.
 */
export const OptionalAuth = (): MethodDecorator & ClassDecorator =>
  SetMetadata(IS_OPTIONAL_AUTH, true);
