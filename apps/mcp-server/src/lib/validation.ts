import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';

/**
 * Wrap a Standard Schema (zod, valibot, ...) so that failed validations are reported to
 * a callback. The SDK validates tool input before the tool handler runs and converts a
 * failure into an error result, so without this hook the server would never log it.
 * Validation itself and JSON Schema generation are delegated unchanged to the wrapped schema.
 */
export function withValidationReporting<S extends StandardSchemaWithJSON>(
  schema: S,
  onInvalid: (issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> | undefined }>) => void,
): S {
  const inner = schema['~standard'];
  const wrapped = {
    ...schema,
    '~standard': {
      ...inner,
      validate: async (value: unknown) => {
        const result = await inner.validate(value);
        if (result.issues) onInvalid(result.issues);
        return result;
      },
    },
  };
  return wrapped as S;
}

/** Compact, log-safe description of validation issues: field paths and messages only, never submitted values. */
export function describeIssues(
  issues: ReadonlyArray<{ message: string; path?: ReadonlyArray<PropertyKey | { key: PropertyKey }> | undefined }>,
): string {
  return issues
    .map((issue) => {
      const path = (issue.path ?? []).map((p) => String(typeof p === 'object' ? p.key : p)).join('.');
      return `${path || 'input'}: ${issue.message}`.replace(/\s+/g, ' ').slice(0, 200);
    })
    .join('; ');
}
