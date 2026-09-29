import { z } from 'zod';

/**
 * `YYYY-MM`, the format of experience.start/end and certifications.date. The
 * same pattern is a CHECK constraint on those columns (0002_value_checks).
 */
export const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const yearMonth = z.string().regex(YEAR_MONTH, { message: 'must be YYYY-MM' });
