// Query functions in one module that create and throw the application's own
// error classes.
import { RequestError, TimeoutError } from "./api-errors.js";

const respond = (body) => Promise.resolve(body);

export const invoicesQuery = {
  queryKey: ["invoices"],
  queryFn: async () => {
    const invoices = await respond({ status: 404 });
    if (invoices.status !== 200) {
      throw new RequestError(invoices.status);
    }
    return invoices;
  },
};

export const plansQuery = {
  queryKey: ["plans"],
  queryFn: async () => {
    const plans = await respond({ status: 503 });
    if (plans.status !== 200) {
      throw new RequestError(plans.status);
    }
    return plans;
  },
};

export const exportQuery = {
  queryKey: ["export"],
  queryFn: async () => {
    const job = await respond({ done: false });
    if (!job.done) {
      const error = new TimeoutError("export-timed-out");
      error.name = "TimeoutError";
      throw error;
    }
    return job;
  },
};
