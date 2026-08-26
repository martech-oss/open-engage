import { sessionOnly } from "../orpc/base";
import { getAppBootstrap } from "./service";

export const appBootstrapProcedure = sessionOnly.app.bootstrap.handler(({ context }) =>
  getAppBootstrap(context.database, context.session),
);

export const appProcedures = {
  bootstrap: appBootstrapProcedure,
};
