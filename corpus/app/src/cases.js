// Every corpus case, by the ID its fixture files are named after, as the
// function to call and its arguments. One runner in main.js calls them all,
// so two cases of the same bug share every frame except the one under test.
// corpus/v1/expectations.json says which cases are the same bug.
import * as catalogue from "./catalogue.js";
import { renderCartTotal } from "./cart.js";
import { onSaveClick, saveDraft } from "./drafts.js";
import { renderInvoiceTotal } from "./invoices.js";
import { loadInvoices, syncAll } from "./loading.js";
import { failCalendar, failContacts, failingNetwork, failingParse, failQuota } from "./loading-sources.js";
import { Dashboard, renderPage, Settings } from "./react-app.js";
import { loadProfile, loadReport } from "./requests.js";
import { openBillingStatements, openReportStatements } from "./statements-entry.js";
import { renderSummary } from "./summary.js";
import { chain, depthOf } from "./tree.js";

export const cases = {
  // One helper, thrown from different callers or call sites.
  "helper-from-cart": [renderCartTotal, {}],
  "helper-from-invoice": [renderInvoiceTotal, {}],
  "summary-subtotal-missing": [renderSummary, { shipping: 4 }],
  "summary-shipping-missing": [renderSummary, { subtotal: 20 }],

  // Recursion depth: the first two fit in every engine's stack, the last is
  // deeper than Chromium's and WebKit's stack limits.
  "recursion-shallow": [depthOf, chain(2)],
  "recursion-moderate": [depthOf, chain(6)],
  "recursion-deep": [depthOf, chain(30)],

  // Async boundaries; both reach window as unhandled rejections.
  "draft-save-direct": [saveDraft, {}],
  "draft-save-awaited": [onSaveClick, {}],
  "statements-from-billing": [openBillingStatements],
  "statements-from-reports": [openReportStatements],

  // Cause chains and AggregateError.
  "invoices-network-cause": [loadInvoices, failingNetwork],
  "invoices-parse-cause": [loadInvoices, failingParse],
  "sync-one-failure": [syncAll, [failContacts]],
  "sync-two-failures": [syncAll, [failCalendar, failQuota]],

  // One component under different React trees.
  "price-tag-in-dashboard": [renderPage, Dashboard],
  "price-tag-in-settings": [renderPage, Settings],

  // Two different bugs with the same message.
  "profile-request-failed": [loadProfile, { ok: false }],
  "report-request-failed": [loadReport, { status: 500 }],

  // Message catalogue: literal and computed forms.
  "read-undefined-id": [catalogue.userId, undefined],
  "read-undefined-name": [catalogue.userName, undefined],
  "read-undefined-computed-id": [catalogue.field, undefined, "id"],
  "read-undefined-computed-name": [catalogue.field, undefined, "name"],
  "read-null-email": [catalogue.userEmail, null],
  "read-null-computed-email": [catalogue.field, null, "email"],
  "call-missing-method": [catalogue.save, {}],
  "call-missing-computed-method": [catalogue.invoke, {}, "save"],
  "undefined-variable": [catalogue.useMissingHelper],
  "spread-undefined": [catalogue.copy, undefined],
  "iterate-number": [catalogue.sum, 42],
  "write-undefined-name": [catalogue.rename, undefined],
  "write-undefined-computed-name": [catalogue.assign, undefined, "name"],
  "construct-missing-class": [catalogue.make, {}],
  "parse-invalid-json": [catalogue.parseSettings, "{settings"],
  "invalid-array-length": [catalogue.allocate, -1],
  "in-operator-on-undefined": [catalogue.hasId, undefined],
};
