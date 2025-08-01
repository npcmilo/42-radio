/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as crons from "../crons.js";
import type * as discogs from "../discogs.js";
import type * as logger from "../logger.js";
import type * as maintenance from "../maintenance.js";
import type * as queueManager from "../queueManager.js";
import type * as radio from "../radio.js";
import type * as users from "../users.js";
import type * as youtube from "../youtube.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  discogs: typeof discogs;
  logger: typeof logger;
  maintenance: typeof maintenance;
  queueManager: typeof queueManager;
  radio: typeof radio;
  users: typeof users;
  youtube: typeof youtube;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
