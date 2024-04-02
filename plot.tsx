/** @jsx jsx */
import { Hono } from "https://deno.land/x/hono@v4.2.0/mod.ts";
import { jsx } from "https://deno.land/x/hono@v4.2.0/middleware.ts";
// import * as Plot from "npm:@observablehq/plot@0.6.14";

function Plot() {
  return <h1>Open to-dos over time</h1>;
}

export const plotsApp = new Hono();
plotsApp.get("/", (c) => {
  return c.html(<Plot />);
});
