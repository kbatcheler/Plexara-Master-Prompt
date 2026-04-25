// `./generated/types` is Orval's TS-type companion to the zod schemas in
// `./generated/api`. Re-exporting both with `export *` causes name
// collisions (e.g. the `DismissAlertBody` zod schema vs the `DismissAlertBody`
// TS interface), which makes TypeScript treat the collided names as having
// no exports at all.
//
// Resolution: surface `./generated/api` (zod schemas — these are what every
// runtime caller wants) at the top level, and namespace the TS-only types
// under `Types` so consumers that need the static interfaces can reach them
// without colliding with the schemas. `z.infer<typeof Schema>` remains the
// preferred way to derive types from schemas in handlers.
export * from "./generated/api";
export * as Types from "./generated/types";
