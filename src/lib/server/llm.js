import OpenAI from "openai";
import { config } from "./config.js";

export const llmClient = new OpenAI({
  baseURL: config.llm.baseURL,
  apiKey: config.llm.apiKey,
});

export function toOpenAITools(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: zodToJsonSchema(tool.schema),
    },
  }));
}

function zodToJsonSchema(schema) {
  if (schema?._def?.typeName === "ZodObject") {
    const shape = schema._def.shape();
    const properties = {};
    const required = [];

    for (const [key, value] of Object.entries(shape)) {
      properties[key] = zodFieldToJson(value);
      if (!isOptional(value)) {
        required.push(key);
      }
    }

    return {
      type: "object",
      properties,
      ...(required.length ? { required } : {}),
    };
  }

  return { type: "object", properties: {} };
}

function isOptional(schema) {
  return (
    schema?._def?.typeName === "ZodOptional" ||
    schema?._def?.typeName === "ZodDefault"
  );
}

function unwrap(schema) {
  if (schema?._def?.typeName === "ZodOptional") {
    return schema._def.innerType;
  }
  if (schema?._def?.typeName === "ZodDefault") {
    return schema._def.innerType;
  }
  return schema;
}

function zodFieldToJson(schema) {
  const inner = unwrap(schema);
  const typeName = inner?._def?.typeName;

  if (typeName === "ZodString") {
    return {
      type: "string",
      ...(inner._def.description ? { description: inner._def.description } : {}),
    };
  }
  if (typeName === "ZodNumber") {
    return {
      type: "number",
      ...(inner._def.description ? { description: inner._def.description } : {}),
    };
  }
  if (typeName === "ZodBoolean") {
    return { type: "boolean" };
  }

  return { type: "string" };
}
