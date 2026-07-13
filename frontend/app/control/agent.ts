import type {
  Elements,
  MazeControlDispatch,
  MazeControlFeedback,
  MazeControlMode,
} from "../types"

// createAgentMode keeps the agent-facing control contract ready while transport wiring is pending.
export function createAgentMode(
  elements: Elements,
): MazeControlMode {
  let attached = false
  let lastCommandFeedback: MazeControlFeedback | null = null
  void elements

  return {
    name: "agent-api",
    attach(dispatch: MazeControlDispatch) {
      if (attached) {
        return
      }

      // Agent wiring will attach here once the WebSocket bridge to the MCP server is introduced.
      void dispatch
      attached = true
    },
    detach() {
      if (!attached) {
        return
      }

      // Agent wiring is still pending, so there are no listeners to release yet.
      attached = false
    },
    expectsCommandFeedback() {
      return true
    },
    getLastCommandFeedback() {
      return lastCommandFeedback
    },
    receiveCommandFeedback(feedback: MazeControlFeedback) {
      lastCommandFeedback = feedback
    },
  }
}
