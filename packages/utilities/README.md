# @tryopenbot/utilities

Small shared utilities without domain ownership. It centralizes Handlebars-based file generation
and JSON value narrowing shared by OpenBot packages.

## Public API

### Functions

- `renderFileTemplate(source, values?)` compiles a Handlebars template string with strict variable resolution and no HTML escaping.
- `renderFileTemplatePath(path, values?)` reads and renders a Handlebars template file.
- `materializeFileTemplate(sourcePath, destinationPath, values?, writeOptions?)` renders a template and writes it to disk, creating parent directories.
- `isRecord(value)` and `isJsonObject(value)` reject null and arrays while narrowing object values.
- `stringField(value, key)` reads a non-empty string without changing whitespace.
- `trimmedStringField(value, key)` trims a non-empty string and rejects whitespace-only values.
- `parseJsonValue(input)` parses JSON and returns `undefined` instead of throwing for malformed input.

### Types

- `FileTemplateValues` is the read-only mapping passed to templates.
- `JsonPrimitive`, `JsonValue`, and `JsonObject` model JSON-compatible values.

The functions are exported from the package root and the focused
`@tryopenbot/utilities/file-template` or `@tryopenbot/utilities/json` subpath.
