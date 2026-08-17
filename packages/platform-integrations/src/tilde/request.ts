export type WithoutUndefined<T extends object> = {
  [Key in keyof T as undefined extends T[Key] ? never : Key]: T[Key];
} & {
  [Key in keyof T as undefined extends T[Key] ? Key : never]?: Exclude<T[Key], undefined>;
};

/** Build an SDK request object without serializing fields that callers did not provide. */
export function omitUndefinedProperties<const T extends object>(source: T): WithoutUndefined<T> {
  const target: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(source)) {
    const value = source[key as keyof T];
    switch (value) {
      case undefined:
        break;
      default:
        target[key] = value;
    }
  }
  return target as WithoutUndefined<T>;
}

/** Preserve existing request behavior where empty values mean that a field is omitted. */
type Falsy = false | 0 | 0n | "" | null | undefined;

export function undefinedWhenFalsy<const T>(value: T): Exclude<T, Falsy> | undefined {
  switch (Boolean(value)) {
    case true:
      return value as Exclude<T, Falsy>;
    case false:
      return undefined;
  }
}
