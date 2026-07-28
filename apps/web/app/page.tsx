import { projectView, type GameState } from "@roft/engine";

const demo: GameState = { version: 1, phase: "lobby", seats: [{ userId: "demo" }] };

export default function Home() {
  const view = projectView(demo, 0);
  return <main><h1>ROFT-DLC</h1><p>engine ok · phase: {view.phase} · v{view.version}</p></main>;
}
