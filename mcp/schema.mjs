// A small checker for tool arguments against the JSON schemas this server publishes.
// Supports: object with properties, required, additionalProperties false; string (enum, pattern, minLength),
// number and integer (minimum, maximum), boolean, array (items). Returns a plain sentence, or null when fine.

function typeName(value) {
  if (Array.isArray(value)) return "a list";
  if (value === null) return "null";
  return { string: "text", number: "a number", boolean: "true or false", object: "an object" }[typeof value] ?? typeof value;
}

function checkValue(label, value, schema) {
  switch (schema.type) {
    case "string": {
      if (typeof value !== "string") return `${label} must be text (got ${typeName(value)}).`;
      if (schema.enum && !schema.enum.includes(value)) return `${label} must be one of ${schema.enum.join(", ")} (got ${JSON.stringify(value)}).`;
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${label} ${JSON.stringify(value)} is not allowed: ${schema.description ?? schema.pattern}`;
      if (schema.minLength && value.length < schema.minLength) return `${label} must not be empty.`;
      return null;
    }
    case "number":
    case "integer": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `${label} must be a number (got ${typeName(value)}).`;
      if (schema.type === "integer" && !Number.isInteger(value)) return `${label} must be a whole number.`;
      if (schema.minimum !== undefined && value < schema.minimum) return `${label} must be at least ${schema.minimum}.`;
      if (schema.maximum !== undefined && value > schema.maximum) return `${label} must be at most ${schema.maximum}.`;
      return null;
    }
    case "boolean":
      return typeof value === "boolean" ? null : `${label} must be true or false (got ${typeName(value)}).`;
    case "array": {
      if (!Array.isArray(value)) return `${label} must be a list (got ${typeName(value)}).`;
      if (schema.minItems && value.length < schema.minItems) return `${label} needs at least ${schema.minItems} item${schema.minItems === 1 ? "" : "s"}.`;
      for (let i = 0; i < value.length; i++) {
        const problem = checkValue(`${label}[${i}]`, value[i], schema.items ?? {});
        if (problem) return problem;
      }
      return null;
    }
    default:
      return null;
  }
}

export function validateArguments(args, inputSchema) {
  const properties = inputSchema.properties ?? {};
  for (const key of inputSchema.required ?? []) {
    if (args[key] === undefined || args[key] === null) return `The input ${key} is required.`;
  }
  for (const key of Object.keys(args)) {
    if (!(key in properties)) return `Unknown input ${key}. The inputs of this tool are: ${Object.keys(properties).join(", ") || "none"}.`;
  }
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null) continue;
    const problem = checkValue(`The input ${key}`, value, properties[key]);
    if (problem) return problem;
  }
  return null;
}
