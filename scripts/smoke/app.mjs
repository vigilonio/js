// ESM consumer app, started with `node --import @vigilon/node/register`.
// express must be imported with ESM syntax here: that is the code path the
// loader hook in register.mjs exists for.
import express from "express";
import * as vigilon from "@vigilon/node";
import { runScenario } from "./scenario.cjs";

runScenario({ label: "ESM", express, vigilon });
