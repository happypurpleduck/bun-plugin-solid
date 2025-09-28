import type { BunPlugin } from "bun";
import { transformAsync } from "@babel/core";
// @ts-expect-error
import ts from "@babel/preset-typescript";
// @ts-expect-error
import solid from "babel-preset-solid";
import solidRefresh from "solid-refresh/babel";

export interface SolidPluginOptions {
    generate?: "dom" | "ssr";
    hydratable?: boolean;
    hot?: boolean;
}

export function BunPluginSolid(options: SolidPluginOptions = {}): BunPlugin {
    options.hot = options.hot ?? process.env.NODE_ENV !== "production";

    return {
        name: "bun-plugin-solid",
        async setup(build) {
            const runtimeCode = options.hot
                ? await Bun.file(
                      Bun.fileURLToPath(
                          import.meta.resolve("./solid-refresh.ts"),
                      ),
                  ).text()
                : "";

            if (options.hot) {
                build.onResolve({ filter: /^solid-refresh$/ }, () => {
                    return {
                        path: "solid-refresh",
                        namespace: "solid-hmr",
                    };
                });

                build.onLoad(
                    {
                        filter: /^solid-refresh$/,
                        namespace: "solid-hmr",
                    },
                    () => ({
                        contents: runtimeCode,
                        loader: "ts",
                    }),
                );
            }

            build.onLoad({ filter: /\.(js|ts)x$/ }, async (args) => {
                const code = await Bun.file(args.path).text();
                const plugins = [];

                if (options.generate !== "ssr" && options.hot) {
                    plugins.push([solidRefresh, { bundler: "vite" }]);
                }

                const transforms = await transformAsync(code, {
                    filename: args.path,
                    presets: [
                        [solid, options],
                        [ts, {}],
                    ],
                    plugins,
                });

                return {
                    contents: transforms!.code!,
                    loader: "js",
                };
            });
        },
    };
}

export default BunPluginSolid();
