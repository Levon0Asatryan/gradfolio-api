import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { ValidationError } from '../../../core/errors/app-error.js';
import { zodBody, zodQuery } from './zod-validation.pipe.js';

const schema = z.object({
  title: z.string().min(1),
  tags: z.array(z.string()).max(2),
});

describe('ZodValidationPipe', () => {
  it('returns the parsed value, with unknown keys stripped', () => {
    expect(zodBody(schema).transform({ title: 'Smart Garden', tags: [], extra: 1 })).toEqual({
      title: 'Smart Garden',
      tags: [],
    });
  });

  it('rejects with every failing path', () => {
    let caught: unknown;
    try {
      zodBody(schema).transform({ title: '', tags: ['a', 'b', 'c'] });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    const details = (caught as ValidationError).details as { path: string }[];
    expect(details.map((d) => d.path).sort()).toEqual(['tags', 'title']);
  });

  it('names the root when the whole payload is the wrong type', () => {
    expect(() => zodQuery(schema).transform('not an object')).toThrow(ValidationError);
    try {
      zodQuery(schema).transform(null);
    } catch (err) {
      expect(((err as ValidationError).details as { path: string }[])[0]?.path).toBe('(root)');
    }
  });
});
