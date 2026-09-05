// CommonJS consumer app, started with `node --require @vigilon/node/register`.
const assert = require("node:assert");
const express = require("express");
const vigilon = require("@vigilon/node");
const { runScenario } = require("./scenario.cjs");

assert(require.resolve("@vigilon/node/register").endsWith("register.cjs"), "register preload resolves (CJS)");
runScenario({ label: "CJS", express, vigilon });
