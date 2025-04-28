import { object, custom } from 'valibot';
import { createSubjects } from '@openauthjs/openauth';
import { validate as isUUIDv4 } from 'uuid';

const uuidSchema = custom<string>(isUUIDv4, 'Invalid UUID v4');

export const subjects = createSubjects({
  user: object({
    userId: uuidSchema,
  }),
});
