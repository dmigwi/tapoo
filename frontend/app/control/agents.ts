import type {
  Elements,
  MazeControlDispatch,
  MazeControlFeedback,
  MazeControlMode,
} from "../types"

// createAgentsMode keeps the agent-facing control contract ready while transport wiring is pending.
export function createAgentsMode(
  elements: Elements,
): MazeControlMode {
  let attached = false
  let lastCommandFeedback: MazeControlFeedback | null = null
  void elements

  return {
    name: "agents",
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
