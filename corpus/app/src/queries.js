// Query definitions in the shape a data-fetching library takes: every
// function is named queryFn, all of them live in one module, and each one
// validates its response with a schema from a dependency. They differ only
// in the line that fails.
import { object } from "./third-party/schema.js";

const profileSchema = object(["name"]);
const reportSchema = object(["rows"]);
const settingsSchema = object(["theme"]);
const respond = (body) => Promise.resolve(body);

export const profileQuery = {
  queryKey: ["profile"],
  queryFn: async () => {
    const data = await respond({ id: 1 });
    return profileSchema.parse(data);
  },
};

export const reportQuery = {
  queryKey: ["report"],
  queryFn: async () => {
    const data = await respond({ id: 2 });
    return reportSchema.parse(data);
  },
};

// The failing call spread over several lines.
export const settingsQuery = {
  queryKey: ["settings"],
  queryFn: async () => {
    const data = await respond({ id: 3 });
    return settingsSchema
      .parse(
        data,
      );
  },
};
