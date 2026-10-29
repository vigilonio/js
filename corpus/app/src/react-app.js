import { captureException } from "@vigilon/browser";
import { Component, createElement as h } from "react";
import { createRoot } from "react-dom/client";

function PriceTag({ product }) {
  return h("span", null, product.currency.toUpperCase());
}

function Card({ product }) {
  return h("div", { className: "card" }, h(PriceTag, { product }));
}

export function Dashboard() {
  return h("main", null, h(Card, { product: {} }));
}

function Panel({ product }) {
  return h("section", null, h(PriceTag, { product }));
}

export function Settings() {
  return h("main", null, h(Panel, { product: {} }));
}

class ErrorBoundary extends Component {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/** Renders a page under an error boundary, reporting what it catches. */
export function renderPage(Page) {
  createRoot(document.getElementById("root"), {
    onCaughtError(error, info) {
      captureException(error, {
        mechanism: "react_error_boundary",
        handled: true,
        componentStack: info.componentStack,
      });
    },
  }).render(h(ErrorBoundary, null, h(Page)));
}
