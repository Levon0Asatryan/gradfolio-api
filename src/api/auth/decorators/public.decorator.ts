import { SetMetadata } from '@nestjs/common';
import { IS_PUBLIC } from '../auth.constants.js';

/**
 * Opts a controller or route out of the access-token requirement. Every route
 * without it needs a valid token: protection is the default, so a forgotten
 * decorator fails closed.
 */
export const Public = (): MethodDecorator & ClassDecorator => SetMetadata(IS_PUBLIC, true);
