import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { flipperClient } from "../flipper/client.js";
import { ViewModelState } from "../flipper/types.js";

const VIEWMODEL_PLUGIN_ID = "view-model-state";
const STATE_UPDATE_METHOD = "stateUpdate";
const BUFFER_SIZE = 100;

let viewModelBuffer: ViewModelState[] = [];

flipperClient.on("plugin-message", ({ pluginId, method, data }) => {
  if (pluginId === VIEWMODEL_PLUGIN_ID && method === STATE_UPDATE_METHOD) {
    const state = data as ViewModelState;
    if (state.viewModel) {
      viewModelBuffer.push(state);
      if (viewModelBuffer.length > BUFFER_SIZE) {
        viewModelBuffer.shift();
      }
    }
  }
});

export function registerViewModelTools(server: McpServer): void {
  server.registerTool("flipper_get_viewmodel_states", {
    description: "Obtiene los cambios de estado de los ViewModels.",
    inputSchema: {
      limit: z
        .number()
        .optional()
        .describe("Límite de registros (default: 20)"),
      viewModel: z
        .string()
        .optional()
        .describe("Filtrar por nombre de ViewModel"),
      action: z
        .enum(["Init", "Update", "Clear"])
        .optional()
        .describe("Filtrar por tipo de acción"),
    },
  }, async (args) => {
    const limit = args.limit ?? 20;
    const vmFilter = args.viewModel;
    const actionFilter = args.action;

    let states = [...viewModelBuffer];

    if (vmFilter) {
      states = states.filter((s) =>
        s.viewModel.toLowerCase().includes(vmFilter.toLowerCase()),
      );
    }

    if (actionFilter) {
      states = states.filter((s) => s.action === actionFilter);
    }

    const recentStates = states.slice(-limit);

    const formatted = recentStates
      .map((s) => {
        const diff = s.differences ? JSON.stringify(s.differences) : "{}";
        return `[${s.date}] ${s.viewModel} (${s.action})\n    Diff: ${diff}`;
      })
      .join("\n");

    return {
      content: [
        { type: "text" as const, text: formatted || "No View Model states found." },
      ],
    };
  });
}
