import type { ScreenStatus } from "../lib/screenState.js";

export function Home({ onStatus: _onStatus }: { onStatus?: (status: ScreenStatus) => void } = {}) {
  return (
    <div className="home">
      <header className="home__header">
        <h1 className="home__title">Home</h1>
        <p className="home__lede">What needs you and what is moving.</p>
      </header>
    </div>
  );
}
